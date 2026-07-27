local removed = redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])

if redis.call('GET', KEYS[3]) == 'QUEUED' then
  redis.call('SET', KEYS[3], 'IDLE', 'PX', ARGV[2])
end

return cjson.encode({status = 'LEFT', left = removed == 1})
