import { join } from 'node:path';
import { seedFiles } from '../../../src/cli/entities-export.js';

describe('entities:export', () => {
  it('each published revision goes to client/shared/entity/seed/<kind>/<id>.js with its stored text', () => {
    expect(seedFiles('/c', [{ entityId: 'cactus', kind: 'prop', source: 'export default {};\n', seq: 3 }])).toEqual([{ path: join('/c', 'shared', 'entity', 'seed', 'prop', 'cactus.js'), source: 'export default {};\n', label: 'prop/cactus #3' }]);
  });

  it('refuses path traversal or unknown kinds', () => {
    expect(() => seedFiles('/c', [{ entityId: '../pwn', kind: 'prop', source: '', seq: 1 }])).toThrow(/bad seed path/);
    expect(() => seedFiles('/c', [{ entityId: 'cactus', kind: '../etc', source: '', seq: 1 }])).toThrow(/bad seed path/);
  });
});
