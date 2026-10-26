import { createServer } from 'node:net';

// Hold the RPC/websocket pair while choosing faucet/gossip ports: sequential ephemeral ports can collide otherwise.
export async function validatorPorts() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const sockets = [];
    const reserve = async port => {
      const server = createServer(); sockets.push(server);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      return server.address().port;
    };
    try {
      const rpcPort = await reserve(0);
      if (rpcPort === 65535) continue;
      await reserve(rpcPort + 1);
      return { rpcPort, faucetPort: await reserve(0), gossipPort: await reserve(0) };
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
    finally { await Promise.all(sockets.map(server => new Promise(resolve => server.close(resolve)))); }
  }
  throw new Error('no free validator RPC/websocket pair');
}
