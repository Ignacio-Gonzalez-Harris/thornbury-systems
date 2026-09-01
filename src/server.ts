import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customers, invoices, workOrders } from './db.ts';
import { totalFor, outstandingFor } from './invoices/calc.ts';
import { statementFor } from './invoices/statement.ts';
import { dispatch } from './scheduling/dispatch.ts';
import { slotsFor } from './scheduling/slots.ts';
import { format } from './shared/money.ts';

const PORT = Number(process.env.PORT ?? 4310);

// The web UI lives in public/ and is served under /app. Files are read per
// request so there is no build or restart step while editing them.
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(res: import('node:http').ServerResponse, fileParts: string[]) {
  const name = fileParts.length === 0 ? 'index.html' : fileParts.join('/');
  // Flat directory, plain filenames only — anything else is not a UI asset.
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) {
    return json(res, 404, { error: 'no such route' });
  }
  const ext = name.slice(name.lastIndexOf('.'));
  const mime = MIME_TYPES[ext];
  if (!mime) return json(res, 404, { error: 'no such route' });
  try {
    const body = readFileSync(join(PUBLIC_DIR, name));
    res.writeHead(200, { 'content-type': mime });
    return res.end(body);
  } catch {
    return json(res, 404, { error: 'no such route' });
  }
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

export const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] === 'app') {
    return serveStatic(res, parts.slice(1));
  }

  if (parts.length === 0) {
    return json(res, 200, {
      service: 'Thornbury Systems billing and scheduling',
      version: '3.11.2',
      routes: [
        'GET /app (web UI)',
        'GET /customers',
        'GET /customers/:id',
        'GET /customers/:id/invoices',
        'GET /customers/:id/statement',
        'GET /invoices',
        'GET /invoices/:id',
        'GET /work-orders',
        'GET /dispatch',
        'GET /slots',
      ],
    });
  }

  if (parts[0] === 'customers' && parts.length === 1) {
    return json(res, 200, customers);
  }

  if (parts[0] === 'customers' && parts.length === 2) {
    const customer = customers.find((c) => c.id === parts[1]);
    if (!customer) return json(res, 404, { error: 'no such customer' });
    return json(res, 200, {
      ...customer,
      outstanding: format(outstandingFor(customer.id, invoices)),
    });
  }

  if (parts[0] === 'customers' && parts.length === 3 && parts[2] === 'invoices') {
    return json(res, 200, invoices.filter((i) => i.customerId === parts[1]));
  }

  if (parts[0] === 'customers' && parts.length === 3 && parts[2] === 'statement') {
    const customer = customers.find((c) => c.id === parts[1]);
    if (!customer) return json(res, 404, { error: 'no such customer' });
    return json(res, 200, statementFor(customer, invoices));
  }

  if (parts[0] === 'invoices' && parts.length === 1) {
    return json(
      res,
      200,
      invoices.map((invoice) => {
        const totals = totalFor(invoice);
        return { ...invoice, ...totals, display: format(totals.total) };
      }),
    );
  }

  if (parts[0] === 'invoices' && parts.length === 2) {
    const invoice = invoices.find((i) => i.id === parts[1]);
    if (!invoice) return json(res, 404, { error: 'no such invoice' });
    const totals = totalFor(invoice);
    return json(res, 200, { ...invoice, ...totals, display: format(totals.total) });
  }

  if (parts[0] === 'work-orders') {
    return json(res, 200, workOrders);
  }

  if (parts[0] === 'dispatch') {
    return json(res, 200, dispatch(workOrders));
  }

  if (parts[0] === 'slots') {
    return json(res, 200, slotsFor(workOrders));
  }

  return json(res, 404, { error: 'no such route', path: url.pathname });
});

if (process.argv[1]?.endsWith('server.ts')) {
  server.listen(PORT, () => {
    console.log(`Thornbury Systems listening on http://localhost:${PORT}`);
  });
}
