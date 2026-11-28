const MAP: Record<string, string> = {
  // auth
  invalid_json: 'The request could not be read. Refresh and try again.',
  wallet_required: 'A wallet address is required.',
  invalid_wallet: 'That wallet address is not valid.',
  signature_required: 'A signature is required to log in.',
  invalid_signature: 'The signature did not match the wallet. Try logging in again.',
  unauthorized: 'You are not logged in. Please sign in first.',

  // events
  name_required: 'An event name is required.',
  dates_required: 'Start and end dates are required.',
  invalid_decimals: 'The token decimals value is not valid.',
  invalid_max_participants: 'The maximum participants value is not valid.',
  invalid_date_format: 'Use YYYY-MM-DD for dates.',
  end_date_before_start_date: 'The end date must be after the start date.',
  days_out_of_range: 'The event must be between 1 and 31 days.',
  not_found: 'That item was not found.',
  duplicate_phone: 'That phone number is already registered.',
  phone_required: 'A phone number is required.',
  invalid_phone: 'That phone number is not valid.',
  programme_not_created: 'The programme has not been created on chain yet.',
  vault_underfunded: 'The vault does not hold enough tokens to cover all participants.',
  participants_already_claimed: 'Participants have already started claiming; the list cannot be changed.',
  invalid_type: 'The link type must be "trainer" or "trainee".',

  // trainer / claim
  bad_amounts: 'One or more daily amounts in the CSV are not valid numbers.',
  not_claimed: 'This trainee has not claimed their wallet yet. Ask them to claim it first.',
  bad_request: 'The request was missing required fields.',
  unknown_link: 'That link code was not found.',
  bad_credentials_format: 'The username or password format is not valid.',
  bad_wallet: 'The wallet address is not valid.',
  bad_blob: 'The encrypted key blob is not valid.',
  not_on_list: 'Your phone number is not on the participant list.',
  already_signed_up: 'This trainer has already signed up.',
  duplicate_entry: 'A duplicate entry was found.',
  invalid_state: 'This action is not allowed in the current state.',
  wrong_password: 'The password is incorrect.',
  wrong_pin: 'The PIN is incorrect.',
  topup_cap: 'The SOL top-up cap has been reached for this trainer.',
  busy: 'The server is busy. Wait a moment and try again.',
  too_many_attempts: 'Too many attempts. Wait a few minutes and try again.',
  not_funded: 'The event vault has not been funded yet.',
  bad_pin_format: 'The PIN must be 6 digits.',
  already_claimed: 'This phone number has already claimed a wallet.',
  wallet_in_use: 'That wallet is already in use.',
  not_enrolled: 'You are not enrolled yet. Complete the claim step first.',

  // relay
  relay_not_configured: 'The relay is not configured on the server.',
  bad_tx: 'The transaction could not be decoded.',
  too_large: 'The transaction is too large.',
  wrong_program: 'The transaction targets the wrong program.',
  bad_signature: 'The trainer signature on the transaction is missing or invalid.',
  trainer_not_registered: 'The trainer is not registered for this programme.',
  unknown_event: 'That event was not found.',
  expired: 'The relay has expired. The trainer must scan again.',

  // chain errors
  chain_unavailable: 'The Solana RPC is not responding. Try again in a moment.',

  // program errors 6000–6016
  InvalidDays: 'The number of days must be between 1 and 31. Check the event settings.',
  InvalidDayLength: 'Each day must be at least 60 seconds long.',
  StartInPast: 'The programme start time is in the past. Use a future start time.',
  InvalidCapacity: 'The maximum participants must be at least 1.',
  Unauthorized: 'Only the event organizer can do that.',
  InvalidBackend: 'The backend key does not match this programme. Restart the backend with the correct address.',
  MathOverflow: 'A calculation overflowed. The amounts may be too large.',
  ProgrammeClosed: 'The programme has ended or funds were already reclaimed.',
  ProgrammeFull: 'The programme has reached its maximum number of participants.',
  ZeroAmount: 'The payment amount must be greater than zero.',
  WrongScheduleLength: 'The number of daily amounts must match the number of programme days.',
  InsufficientFunding: 'The vault does not hold enough tokens to cover all promised payments.',
  TrainerIsTrainee: 'The trainer and participant must be different wallets.',
  NotStarted: 'The programme has not started yet. Wait until the start time.',
  WrongDay: 'The day does not match the current programme day.',
  AlreadyCheckedIn: 'This participant has already been checked in and paid for today.',
  EventNotOver: 'Funds can only be reclaimed after the programme ends.',

  // Anchor system error
  AccountNotInitialized: 'The trainer is not registered for this programme.',
};

export function explain(code: string): string {
  return MAP[code] ?? 'Something went wrong. Please try again.';
}
