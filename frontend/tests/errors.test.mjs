import test from 'node:test'
import assert from 'node:assert/strict'
import { explain } from '../src/lib/errors.ts'

const FALLBACK = 'Something went wrong. Please try again.'

test('known codes map to plain sentences', () => {
  assert.equal(explain('wrong_pin'), 'The PIN is incorrect.')
  assert.equal(explain('unauthorized'), 'You are not logged in. Please sign in first.')
  assert.equal(explain('WrongDay'), 'The day does not match the current programme day.')
  assert.equal(explain('bad_amounts'), 'One or more daily amounts in the CSV are not valid numbers.')
  assert.equal(explain('not_claimed'), 'This trainee has not claimed their wallet yet. Ask them to claim it first.')
})

test('unknown codes use the fallback and never show the raw code', () => {
  for (const code of ['nope', 'Bad Request', 'unknown', '', 'not_found_xyz']) {
    const msg = explain(code)
    assert.equal(msg, FALLBACK)
    assert.ok(!msg.includes(code) || code === '')
  }
})

test('every known code gives a non-empty sentence ending in a full stop', () => {
  const codes = [
    'invalid_json','wallet_required','invalid_wallet','signature_required','invalid_signature','unauthorized',
    'name_required','dates_required','invalid_decimals','invalid_max_participants','invalid_date_format',
    'end_date_before_start_date','days_out_of_range','not_found','duplicate_phone','phone_required','invalid_phone',
    'programme_not_created','vault_underfunded','participants_already_claimed','invalid_type',
    'bad_amounts','not_claimed','bad_request','unknown_link','bad_credentials_format','bad_wallet','bad_blob',
    'not_on_list','already_signed_up','duplicate_entry','invalid_state','wrong_password','wrong_pin','topup_cap',
    'busy','too_many_attempts','not_funded','bad_pin_format','already_claimed','wallet_in_use','not_enrolled',
    'relay_not_configured','bad_tx','too_large','wrong_program','bad_signature','trainer_not_registered',
    'unknown_event','expired','chain_unavailable',
    'InvalidDays','InvalidDayLength','StartInPast','InvalidCapacity','Unauthorized','InvalidBackend','MathOverflow',
    'ProgrammeClosed','ProgrammeFull','ZeroAmount','WrongScheduleLength','InsufficientFunding','TrainerIsTrainee',
    'NotStarted','WrongDay','AlreadyCheckedIn','EventNotOver','AccountNotInitialized',
  ]
  for (const c of codes) {
    const msg = explain(c)
    assert.notEqual(msg, FALLBACK, `${c} is missing from MAP`)
    assert.ok(msg.length > 10 && msg.endsWith('.'), `${c}: bad message`)
  }
})
