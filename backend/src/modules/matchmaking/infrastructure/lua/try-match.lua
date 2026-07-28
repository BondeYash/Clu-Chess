local queue_key = KEYS[1]
local reservation_key = KEYS[2]
local mode = ARGV[1]
local now = tonumber(ARGV[2])
local max_wait = tonumber(ARGV[3])
local match_id = ARGV[4]
local game_id = ARGV[5]
local reservation_ttl = tonumber(ARGV[6])
local guard_ttl = tonumber(ARGV[7])
local guard_prefix = ARGV[8]
local state_prefix = ARGV[9]
local active_prefix = ARGV[10]
local presence_prefix = ARGV[11]
local max_scan = tonumber(ARGV[12])

if redis.call('EXISTS', reservation_key) == 1 then
  return cjson.encode({status = 'ERROR', code = 'RESERVATION_MISMATCH'})
end

local candidates = {}
local discarded = {}

local function is_present(key)
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
  local count = redis.call('ZCARD', key)
  if count == 0 then
    redis.call('DEL', key)
  end
  return count > 0
end

local function discard(guest_id, reason)
  redis.call('DEL', guard_prefix .. guest_id)
  local state_key = state_prefix .. guest_id .. ':state'
  if redis.call('GET', state_key) == 'QUEUED' then
    redis.call('DEL', state_key)
  end
  table.insert(discarded, {guestSessionId = guest_id, reason = reason})
end

for _ = 1, max_scan do
  if #candidates == 2 then
    break
  end

  local popped = redis.call('ZPOPMIN', queue_key, 1)
  if #popped == 0 then
    break
  end

  local guest_id = popped[1]
  local score = tonumber(popped[2])
  local state_key = state_prefix .. guest_id .. ':state'
  local guard_key = guard_prefix .. guest_id
  local active_key = active_prefix .. guest_id .. ':active-game'
  local presence_key = presence_prefix .. guest_id
  local reason = nil

  if score <= now - max_wait then
    reason = 'timeout'
  elseif not is_present(presence_key) then
    reason = 'disconnected'
  elseif redis.call('GET', state_key) ~= 'QUEUED'
      or redis.call('GET', guard_key) ~= mode
      or redis.call('EXISTS', active_key) == 1 then
    reason = 'stale'
  end

  if reason then
    discard(guest_id, reason)
  else
    table.insert(candidates, {guestSessionId = guest_id, score = score})
  end
end

if #candidates < 2 then
  for _, candidate in ipairs(candidates) do
    redis.call(
      'ZADD',
      queue_key,
      candidate.score,
      candidate.guestSessionId
    )
    redis.call(
      'PEXPIRE',
      guard_prefix .. candidate.guestSessionId,
      guard_ttl
    )
  end

  local response = {status = 'NO_MATCH'}
  if #discarded > 0 then
    response.discarded = discarded
  end
  return cjson.encode(response)
end

local a = candidates[1]
local b = candidates[2]
if a.guestSessionId == b.guestSessionId then
  redis.call('ZADD', queue_key, a.score, a.guestSessionId)
  return cjson.encode({status = 'NO_MATCH'})
end

redis.call(
  'SET',
  state_prefix .. a.guestSessionId .. ':state',
  'RESERVED',
  'PX',
  reservation_ttl
)
redis.call(
  'SET',
  state_prefix .. b.guestSessionId .. ':state',
  'RESERVED',
  'PX',
  reservation_ttl
)
redis.call(
  'DEL',
  guard_prefix .. a.guestSessionId,
  guard_prefix .. b.guestSessionId
)
redis.call(
  'HSET',
  reservation_key,
  'matchId',
  match_id,
  'gameId',
  game_id,
  'mode',
  mode,
  'a',
  a.guestSessionId,
  'b',
  b.guestSessionId,
  'aScore',
  a.score,
  'bScore',
  b.score,
  'createdAt',
  now
)
redis.call('PEXPIRE', reservation_key, reservation_ttl)

local response = {
  status = 'MATCHED',
  reservation = {
    matchId = match_id,
    gameId = game_id,
    mode = mode,
    a = a.guestSessionId,
    b = b.guestSessionId,
    aScore = a.score,
    bScore = b.score,
    createdAt = now
  }
}
if #discarded > 0 then
  response.discarded = discarded
end
return cjson.encode(response)
