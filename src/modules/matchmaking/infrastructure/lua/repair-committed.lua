local current_a = redis.call('GET', KEYS[2])
local current_b = redis.call('GET', KEYS[4])

if (current_a and current_a ~= ARGV[1])
    or (current_b and current_b ~= ARGV[1]) then
  return cjson.encode({status = 'ERROR', code = 'RESERVATION_MISMATCH'})
end

local changed = current_a ~= ARGV[1]
    or current_b ~= ARGV[1]
    or redis.call('GET', KEYS[1]) ~= 'IN_GAME'
    or redis.call('GET', KEYS[3]) ~= 'IN_GAME'

redis.call('SET', KEYS[1], 'IN_GAME', 'PX', ARGV[2])
redis.call('SET', KEYS[2], ARGV[1])
redis.call('SET', KEYS[3], 'IN_GAME', 'PX', ARGV[2])
redis.call('SET', KEYS[4], ARGV[1])
redis.call('ZREM', KEYS[5], ARGV[3], ARGV[4])
redis.call('DEL', KEYS[6], KEYS[7])

return cjson.encode({status = 'REPAIRED', changed = changed})
