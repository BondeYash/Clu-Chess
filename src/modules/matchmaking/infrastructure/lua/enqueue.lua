local active_game = redis.call('GET', KEYS[4])
local state = redis.call('GET', KEYS[3])

if active_game or state == 'RESERVED' or state == 'IN_GAME' then
  return cjson.encode({status = 'ERROR', code = 'ALREADY_IN_GAME'})
end

local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if score then
  redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[4])
  redis.call('SET', KEYS[3], 'QUEUED', 'PX', ARGV[5])
  local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
  return cjson.encode({
    status = 'QUEUED',
    duplicate = true,
    since = tonumber(score),
    position = rank + 1
  })
end

redis.call('ZADD', KEYS[1], 'NX', ARGV[3], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[4])
redis.call('SET', KEYS[3], 'QUEUED', 'PX', ARGV[5])

local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
return cjson.encode({
  status = 'QUEUED',
  duplicate = false,
  since = tonumber(ARGV[3]),
  position = rank + 1
})
