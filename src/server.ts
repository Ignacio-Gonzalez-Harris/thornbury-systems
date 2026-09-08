import { createServer } from 'node:http';
import { customers, engineers, invoices, workOrders } from './db.ts';
import {
  ApiError,
  createCustomer,
  createEngineer,
  createInvoice,
  createWorkOrder,
  deleteCustomer,
  deleteEngineer,
  deleteInvoice,
  deleteWorkOrder,
  updateCustomer,
  updateEngineer,
  updateInvoice,
  updateWorkOrder,
} from './crud.ts';
import { totalFor, outstandingFor } from './invoices/calc.ts';
import { statementFor } from './invoices/statement.ts';
import { dispatch } from './scheduling/dispatch.ts';
import { slotsFor } from './scheduling/slots.ts';
import { format } from './shared/money.ts';

const PORT = Number(process.env.PORT ?? 4310);

// A body bigger than this is a client mistake, not an invoice. Deliberately
// answered as a 400 rather than a 413: the PRD documents the status set this
// API uses (201/200/204/400/404/409/500) and the front end only handles those.
const MAX_BODY_BYTES = 1_000_000;

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

// 204 means "done, nothing to say". A body here would be a protocol error.
function noContent(res: import('node:http').ServerResponse) {
  res.writeHead(204);
  res.end();
}

function methodNotAllowed(res: import('node:http').ServerResponse, allow: string) {
  res.setHeader('allow', allow);
  return json(res, 405, { error: 'method not allowed' });
}

// Read the request body and parse it. Every failure here is a 400 raised as an
// ApiError so it goes through the one error-to-status mapping below, rather
// than each route inventing its own reply.
//
// Written with events rather than `for await (const chunk of req)` on purpose:
// throwing out of an async iteration destroys the stream, which on an
// IncomingMessage tears down the socket and the 400 never reaches the client.
// Once res.end() runs, Node discards whatever the client is still sending.
function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;

    req.on('data', (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finished = true;
        reject(new ApiError(400, 'request body is too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    });
  });
}

async function readJson(req: import('node:http').IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (raw.trim() === '') {
    throw new ApiError(400, 'request body is required');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'request body is not valid JSON');
  }
}

export const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    // One place decides what a failure looks like to the caller. A rule the
    // write path enforced (ApiError) carries its own status and message;
    // anything else is a bug here and must not leak its internals.
    if (error instanceof ApiError) {
      return json(res, error.status, { error: error.message });
    }
    console.error(error);
    json(res, 500, { error: 'internal error' });
  });
});

async function handle(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method ?? 'GET';

  if (parts.length === 0) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, {
      service: 'Thornbury Systems billing and scheduling',
      version: '3.11.2',
      routes: [
        'GET /customers',
        'POST /customers',
        'GET /customers/:id',
        'PATCH /customers/:id',
        'DELETE /customers/:id',
        'GET /customers/:id/invoices',
        'GET /customers/:id/statement',
        'GET /invoices',
        'POST /invoices',
        'GET /invoices/:id',
        'PATCH /invoices/:id',
        'DELETE /invoices/:id',
        'GET /engineers',
        'POST /engineers',
        'PATCH /engineers/:id',
        'DELETE /engineers/:id',
        'GET /work-orders',
        'POST /work-orders',
        'GET /work-orders/:id',
        'PATCH /work-orders/:id',
        'DELETE /work-orders/:id',
        'GET /dispatch',
        'GET /slots',
      ],
    });
  }

  if (parts[0] === 'customers' && parts.length === 1) {
    if (method === 'GET') return json(res, 200, customers);
    if (method === 'POST') return json(res, 201, createCustomer(await readJson(req)));
    return methodNotAllowed(res, 'GET, POST');
  }

  if (parts[0] === 'customers' && parts.length === 2) {
    if (method === 'GET') {
      const customer = customers.find((c) => c.id === parts[1]);
      if (!customer) return json(res, 404, { error: 'no such customer' });
      return json(res, 200, {
        ...customer,
        outstanding: format(outstandingFor(customer.id, invoices)),
      });
    }
    if (method === 'PATCH') return json(res, 200, updateCustomer(parts[1], await readJson(req)));
    if (method === 'DELETE') {
      deleteCustomer(parts[1]);
      return noContent(res);
    }
    return methodNotAllowed(res, 'GET, PATCH, DELETE');
  }

  if (parts[0] === 'customers' && parts.length === 3 && parts[2] === 'invoices') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, invoices.filter((i) => i.customerId === parts[1]));
  }

  if (parts[0] === 'customers' && parts.length === 3 && parts[2] === 'statement') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const customer = customers.find((candidate) => candidate.id === parts[1]);
    if (!customer) return json(res, 404, { error: 'no such customer' });
    return json(res, 200, statementFor(customer, invoices));
  }

  if (parts[0] === 'invoices' && parts.length === 1) {
    if (method === 'GET') return json(res, 200, invoices);
    if (method === 'POST') return json(res, 201, createInvoice(await readJson(req)));
    return methodNotAllowed(res, 'GET, POST');
  }

  if (parts[0] === 'invoices' && parts.length === 2) {
    if (method === 'GET') {
      const invoice = invoices.find((i) => i.id === parts[1]);
      if (!invoice) return json(res, 404, { error: 'no such invoice' });
      const customer = customers.find((c) => c.id === invoice.customerId);
      if (!customer) return json(res, 500, { error: 'no such customer for invoice' });
      const totals = totalFor(invoice, customer);
      return json(res, 200, { ...invoice, ...totals, display: format(totals.total) });
    }
    if (method === 'PATCH') return json(res, 200, updateInvoice(parts[1], await readJson(req)));
    if (method === 'DELETE') {
      deleteInvoice(parts[1]);
      return noContent(res);
    }
    return methodNotAllowed(res, 'GET, PATCH, DELETE');
  }

  if (parts[0] === 'engineers' && parts.length === 1) {
    if (method === 'GET') return json(res, 200, engineers);
    if (method === 'POST') return json(res, 201, createEngineer(await readJson(req)));
    return methodNotAllowed(res, 'GET, POST');
  }

  if (parts[0] === 'engineers' && parts.length === 2) {
    if (method === 'PATCH') return json(res, 200, updateEngineer(parts[1], await readJson(req)));
    if (method === 'DELETE') {
      deleteEngineer(parts[1]);
      return noContent(res);
    }
    return methodNotAllowed(res, 'PATCH, DELETE');
  }

  if (parts[0] === 'work-orders' && parts.length === 1) {
    if (method === 'GET') return json(res, 200, workOrders);
    if (method === 'POST') return json(res, 201, createWorkOrder(await readJson(req)));
    return methodNotAllowed(res, 'GET, POST');
  }

  if (parts[0] === 'work-orders' && parts.length === 2) {
    if (method === 'GET') {
      const order = workOrders.find((candidate) => candidate.id === parts[1]);
      if (!order) return json(res, 404, { error: 'no such work order' });
      return json(res, 200, order);
    }
    if (method === 'PATCH') return json(res, 200, updateWorkOrder(parts[1], await readJson(req)));
    if (method === 'DELETE') {
      deleteWorkOrder(parts[1]);
      return noContent(res);
    }
    return methodNotAllowed(res, 'GET, PATCH, DELETE');
  }

  if (parts[0] === 'dispatch') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, dispatch(workOrders));
  }

  if (parts[0] === 'slots') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, slotsFor(workOrders));
  }

  return json(res, 404, { error: 'no such route', path: url.pathname });
}

if (process.argv[1]?.endsWith('server.ts')) {
  server.listen(PORT, () => {
    console.log(`Thornbury Systems listening on http://localhost:${PORT}`);
  });
}
