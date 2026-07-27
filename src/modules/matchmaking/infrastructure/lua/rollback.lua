local reservation = redis.call('HGETALL', KEYS[2])
if #reservation == 0 then
  local function is_settled(guest_id, assignment, state_key, active_key, guard_key)
    local active = redis.call('GET', active_key)
    local state = redis.call('GET', state_key)
    if assignment ~= '' then
      return active == assignment and state == 'IN_GAME'
    end

    local score = redis.call('ZSCORE', KEYS[1], guest_id)
    local queued = score
        and state == 'QUEUED'
        and redis.call('GET', guard_key) == ARGV[5]
    local idle = not score and not active and state ~= 'RESERVED'
    return queued or idle
  end

  if is_settled(ARGV[2], ARGV[11], KEYS[3], KEYS[4], KEYS[5])
      and is_settled(ARGV[3], ARGV[12], KEYS[7], KEYS[8], KEYS[9]) then
    return cjson.encode({status = 'ROLLED_BACK'})
  end
  return cjson.encode({status = 'ERROR', code = 'RESERVATION_MISMATCH'})
else
  local values = {}
  for index = 1, #reservation, 2 do
    values[reservation[index]] = reservation[index + 1]
  end
  if values.matchId ~= ARGV[1]
      or values.a ~= ARGV[2]
      or values.b ~= ARGV[3]
      or values.gameId ~= ARGV[4] then
    return cjson.encode({status = 'ERROR', code = 'RESERVATION_MISMATCH'})
  end
end

local now = tonumber(ARGV[8])
local requeued = {}

local function is_present(key)
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
  local count = redis.call('ZCARD', key)
  if count == 0 then
    redis.call('DEL', key)
  end
  return count > 0
end

local function restore(guest_id, score, assignment, eligible, state_key, active_key, guard_key, presence_key)
  if assignment ~= '' then
    redis.call('ZREM', KEYS[1], guest_id)
    redis.call('DEL', guard_key)
    redis.call('SET', state_key, 'IN_GAME', 'PX', ARGV[10])
    redis.call('SET', active_key, assignment)
    return
  end

  redis.call('DEL', active_key)
  if eligible == '1' and is_present(presence_key) then
    local current_score = redis.call('ZSCORE', KEYS[1], guest_id)
    if not current_score or tonumber(score) < tonumber(current_score) then
      redis.call('ZADD', KEYS[1], score, guest_id)
    end
    redis.call('SET', guard_key, ARGV[5], 'PX', ARGV[9])
    redis.call('SET', state_key, 'QUEUED', 'PX', ARGV[10])
    table.insert(requeued, {guestSessionId = guest_id, since = tonumber(score)})
  else
    redis.call('ZREM', KEYS[1], guest_id)
    redis.call('DEL', guard_key)
    redis.call('SET', state_key, 'IDLE', 'PX', ARGV[10])
  end
end

restore(ARGV[2], ARGV[6], ARGV[11], ARGV[13], KEYS[3], KEYS[4], KEYS[5], KEYS[6])
restore(ARGV[3], ARGV[7], ARGV[12], ARGV[14], KEYS[7], KEYS[8], KEYS[9], KEYS[10])
redis.call('DEL', KEYS[2])

local response = {status = 'ROLLED_BACK'}
if #requeued > 0 then
  response.requeued = requeued
end
return cjson.encode(response)
