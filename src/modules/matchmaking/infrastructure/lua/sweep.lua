local queue_key = KEYS[1]
local now = tonumber(ARGV[1])
local max_wait = tonumber(ARGV[2])
local batch = tonumber(ARGV[3])
local mode = ARGV[4]
local guard_prefix = ARGV[5]
local state_prefix = ARGV[6]
local active_prefix = ARGV[7]
local presence_prefix = ARGV[8]
local state_ttl = tonumber(ARGV[9])
local entries = redis.call('ZRANGE', queue_key, 0, batch - 1, 'WITHSCORES')
local removed = {}

local function is_present(key)
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
  local count = redis.call('ZCARD', key)
  if count == 0 then
    redis.call('DEL', key)
  end
  return count > 0
end

for index = 1, #entries, 2 do
  local guest_id = entries[index]
  local score = tonumber(entries[index + 1])
  local guard_key = guard_prefix .. guest_id
  local state_key = state_prefix .. guest_id .. ':state'
  local active_key = active_prefix .. guest_id .. ':active-game'
  local reason = nil

  if score <= now - max_wait then
    reason = 'timeout'
  elseif not is_present(presence_prefix .. guest_id) then
    reason = 'disconnected'
  elseif redis.call('GET', guard_key) ~= mode
      or redis.call('GET', state_key) ~= 'QUEUED'
      or redis.call('EXISTS', active_key) == 1 then
    reason = 'stale'
  end

  if reason and redis.call('ZREM', queue_key, guest_id) == 1 then
    redis.call('DEL', guard_key)
    if redis.call('GET', state_key) == 'QUEUED' then
      redis.call('SET', state_key, 'IDLE', 'PX', state_ttl)
    end
    table.insert(removed, {guestSessionId = guest_id, reason = reason})
  end
end

local response = {status = 'SWEPT'}
if #removed > 0 then
  response.removed = removed
end
return cjson.encode(response)
