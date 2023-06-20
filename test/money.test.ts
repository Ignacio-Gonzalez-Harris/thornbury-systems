import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format, sum, percentOf, pounds } from '../src/shared/money.ts';

test('format renders pence as pounds', () => {
  assert.equal(format(2400), '£24.00');
  assert.equal(format(195), '£1.95');
  assert.equal(format(0), '£0.00');
});

test('format handles thousands and negatives', () => {
  assert.equal(format(1234567), '£12,345.67');
  assert.equal(format(-500), '-£5.00');
});

test('sum adds pence', () => {
  assert.equal(sum([100, 250, 5]), 355);
  assert.equal(sum([]), 0);
});

test('pounds converts for display', () => {
  assert.equal(pounds(2400), 24);
});

test('late payment percentage rounds to the penny', () => {
  assert.equal(percentOf(10000, 8), 800);
  assert.equal(percentOf(333, 8), 27);
});
