import test from 'node:test'
import assert from 'node:assert/strict'
import { formatAmount, shortAddress, formatCountdown, currentDay } from '../src/lib/format.ts'

test('formatAmount', () => {
  assert.equal(formatAmount('1500000000', 9), '1.5')
  assert.equal(formatAmount(1000000000n, 9), '1')
  assert.equal(formatAmount('0', 9), '0')
  assert.equal(formatAmount(5n, 9), '0.000000005')
  assert.equal(formatAmount('123456789012', 9), '123.456789012')
  assert.equal(formatAmount('1234567', 0), '1,234,567')
  assert.equal(formatAmount('1234567000000000', 9), '1,234,567')
})

test('shortAddress', () => {
  assert.equal(shortAddress('abc'), 'abc')
  assert.equal(shortAddress('2pee4uBKZySQxukJ8cyncGAXks5TSbd2B3NEJRq6AQAF'), '2pee…AQAF')
})

test('formatCountdown', () => {
  assert.equal(formatCountdown(47), '47s')
  assert.equal(formatCountdown(0), '0s')
  assert.equal(formatCountdown(-5), '0s')
  assert.equal(formatCountdown(60), '1m')
  assert.equal(formatCountdown(95), '1m 35s')
})

test('currentDay', () => {
  assert.equal(currentDay(100, 200, 90), 0)
  assert.equal(currentDay(200, 200, 90), 0)
  assert.equal(currentDay(289, 200, 90), 0)
  assert.equal(currentDay(290, 200, 90), 1)
  assert.equal(currentDay(200, 200, 0), 0)
})
