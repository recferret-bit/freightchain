import express from 'express';
import request from 'supertest';
import { beaconBodyMiddleware } from '../../../../src/infrastructure/http/middleware/beacon-body.middleware.js';

describe('beaconBodyMiddleware', () => {
  const app = express();
  app.use(beaconBodyMiddleware);
  app.use(express.json());
  app.use((req, res) => { res.json({ body: req.body ?? null }); });   // every path echoes its parsed body

  it('parses a text/plain JSON beacon on /api/rides/:id/end only; anything else is left to the normal parsers', async () => {
    const send = (path: string, type: string, body: string) => request(app).post(path).set('content-type', type).send(body);
    expect((await send('/api/rides/abc/end', 'text/plain;charset=UTF-8', '{"outcome":"shift","s":12}')).body.body).toEqual({ outcome: 'shift', s: 12 });
    expect((await send('/api/rides/abc/end', 'text/plain', 'not json')).body.body).toEqual({});   // junk → empty (the route's zod then refuses it)
    expect((await send('/api/rides/abc/end', 'application/json', '{"outcome":"failed"}')).body.body).toEqual({ outcome: 'failed' });   // the JSON parser, as before
    expect((await send('/api/rides/abc/heartbeat', 'text/plain', '{"s":1}')).body.body).toBeNull();   // not a beacon route: not parsed at all
    expect((await send('/api/rides/a/b/end', 'text/plain', '{"s":1}')).body.body).toBeNull();
  });
});
