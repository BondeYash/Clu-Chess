local reservation = redis.call('HGETALL', KEYS[1])
local active_a = redis.call('GET', KEYS[4])
local active_b = redis.call('GET', KEYS[6])

if #reservation == 0 then
  if active_a == ARGV[4] and active_b == ARGV[4] then
    return cjson.encode({status = 'FINALIZED', duplicate = true})
  end
  return cjson.encode({status = 'ERROR', code = 'RESERVATION_MISMATCH'})
end

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

redis.call('SET', KEYS[3], 'IN_GAME', 'PX', ARGV[5])
redis.call('SET', KEYS[4], ARGV[4])
redis.call('SET', KEYS[5], 'IN_GAME', 'PX', ARGV[5])
redis.call('SET', KEYS[6], ARGV[4])
redis.call('DEL', KEYS[1], KEYS[2], KEYS[7])

return cjson.encode({status = 'FINALIZED', duplicate = false})
