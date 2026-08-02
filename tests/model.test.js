import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  createBranchMeta,
  readBranchMeta,
  writeBranchMeta,
  isValidBranchMeta,
} from '../src/model/metadata.js';
import {
  buildSnapshotPlan,
  createBranchIdCounter,
  createBranchIdFactory,
  getLastSegment,
  getParentId,
  parseBranchId,
  planMigrateLegacyIds,
  planRenumberAfterDelete,
  replaceBranchIdInFileName,
  ROOT_BRANCH_ID,
  SNAPSHOT_REASONS,
} from '../src/model/branches.js';
import { PanelIndex } from '../src/model/panel-index.js';
import { checkInvariants, validateBranchMeta } from '../src/model/invariants.js';

test('metadata: create/read/write round-trip', () => {
  const meta = createBranchMeta({
    id: 'br_201',
    kind: 'snapshot',
    parent: 'br_200',
    sourceFloor: 2,
    reason: 'roll',
    createdAt: '2026-08-02T10:01:00.000Z',
  });
  assert.equal(meta.schema, SCHEMA_VERSION);

  const chatMetadata = writeBranchMeta({}, meta);
  const parsed = readBranchMeta(chatMetadata);
  assert.equal(parsed.branch.id, 'br_201');
  assert.equal(parsed.branch.kind, 'snapshot');
  assert.equal(parsed.branch.parent, 'br_200');
  assert.equal(parsed.branch.sourceFloor, 2);
  assert.equal(parsed.branch.reason, 'roll');
});

test('metadata: plain ST chat returns null, foreign fields preserved', () => {
  assert.equal(readBranchMeta({}), null);
  assert.equal(readBranchMeta(null), null);
  const out = writeBranchMeta({ existing: 1 }, { schema: 3, branch: { id: 'x' } });
  assert.equal(out.existing, 1);
});

test('metadata: invalid kind is rejected', () => {
  assert.throws(() => createBranchMeta({ id: 'b1', kind: 'bogus' }), TypeError);
});

test('branches: snapshot plan for roll/delete/edit', () => {
  const nextId = createBranchIdFactory('br', 300);
  for (const reason of SNAPSHOT_REASONS) {
    const plan = buildSnapshotPlan({
      currentBranchId: 'br_200',
      currentFileName: 'root.jsonl',
      sourceFloor: 2,
      reason,
      nextBranchId: nextId(),
    });
    assert.equal(plan.operation, 'snapshot');
    assert.equal(plan.kind, 'snapshot');
    assert.equal(plan.parent, 'br_200');
    assert.equal(plan.copyFrom, 'root.jsonl');
    assert.equal(plan.meta.branch.kind, 'snapshot');
    assert.equal(plan.meta.branch.reason, reason);
  }
});

test('branches: invalid snapshot reason throws', () => {
  assert.throws(
    () => buildSnapshotPlan({ currentBranchId: 'br_200', reason: 'root', nextBranchId: 'br_301' }),
    TypeError,
  );
});

test('branches: recursive id utilities', () => {
  assert.deepEqual(parseBranchId('br_000'), { root: '000', segments: [] });
  assert.deepEqual(parseBranchId('br_000-1'), { root: '000', segments: [1] });
  assert.deepEqual(parseBranchId('br_000-1-2'), { root: '000', segments: [1, 2] });
  assert.equal(parseBranchId('orphan_x'), null);
  assert.equal(getParentId('br_000'), null);
  assert.equal(getParentId('br_000-1'), 'br_000');
  assert.equal(getParentId('br_000-1-2'), 'br_000-1');
  assert.equal(getLastSegment('br_000'), null);
  assert.equal(getLastSegment('br_000-1-2'), 2);
  assert.equal(ROOT_BRANCH_ID, 'br_000');
  assert.equal(replaceBranchIdInFileName('Seraphina - [FA] roll 2026-08-02 br_000-2', 'br_000-1'), 'Seraphina - [FA] roll 2026-08-02 br_000-1');
  assert.equal(replaceBranchIdInFileName('Seraphina - delete 2026-08-02 br_000-2 [FA]', 'br_000-1'), 'Seraphina - delete 2026-08-02 br_000-1 [FA]');
});

test('branches: per-parent id counter', () => {
  const counter = createBranchIdCounter();
  assert.equal(counter.next('br_000'), 'br_000-1');
  assert.equal(counter.next('br_000'), 'br_000-2');
  assert.equal(counter.next('br_000-1'), 'br_000-1-1');
  counter.track('br_000-5');
  assert.equal(counter.next('br_000'), 'br_000-6');
  counter.track('br_000-2-3');
  assert.equal(counter.next('br_000-2'), 'br_000-2-4');
  counter.resetParent('br_000', 1);
  assert.equal(counter.next('br_000'), 'br_000-2');
});

test('branches: renumber plan compacts the deleted node sibling bucket', () => {
  const metas = [
    { schema: 3, branch: { id: 'br_000', kind: 'active', parent: null, reason: 'root', file_name: 'Seraphina' } },
    { schema: 3, branch: { id: 'br_000-1', kind: 'snapshot', parent: 'br_000', reason: 'roll', file_name: 'Seraphina - [FA] roll 2026-08-02 br_000-1' } },
    { schema: 3, branch: { id: 'br_000-2', kind: 'snapshot', parent: 'br_000', reason: 'delete', file_name: 'Seraphina - [FA] delete 2026-08-02 br_000-2' } },
  ];
  const plan = planRenumberAfterDelete(metas, 'br_000-1', 'br_000');
  assert.equal(plan.maxSeq, 1);
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.steps[0], {
    branchId: 'br_000-2',
    newId: 'br_000-1',
    fileName: 'Seraphina - [FA] delete 2026-08-02 br_000-2',
    newFileName: 'Seraphina - [FA] delete 2026-08-02 br_000-1',
    newParent: 'br_000',
  });
});

test('branches: renumber plan updates descendant path prefixes recursively', () => {
  const metas = [
    { schema: 3, branch: { id: 'br_000', kind: 'active', parent: null, reason: 'root', file_name: 'root' } },
    { schema: 3, branch: { id: 'br_000-1', kind: 'snapshot', parent: 'br_000', reason: 'roll', file_name: 'x br_000-1' } },
    { schema: 3, branch: { id: 'br_000-2', kind: 'snapshot', parent: 'br_000', reason: 'continue', file_name: 'x br_000-2' } },
    { schema: 3, branch: { id: 'br_000-2-1', kind: 'snapshot', parent: 'br_000-2', reason: 'edit', file_name: 'x br_000-2-1' } },
  ];
  const plan = planRenumberAfterDelete(metas, 'br_000-1', 'br_000');
  assert.equal(plan.maxSeq, 1);
  assert.deepEqual(plan.steps.map((s) => [s.branchId, s.newId, s.newParent]), [
    ['br_000-2', 'br_000-1', 'br_000'],
    ['br_000-2-1', 'br_000-1-1', 'br_000-1'],
  ]);
});

test('branches: renumber plan adopts children of the deleted branch', () => {
  const metas = [
    { schema: 3, branch: { id: 'br_000', kind: 'active', parent: null, reason: 'root', file_name: 'root' } },
    { schema: 3, branch: { id: 'br_000-1', kind: 'snapshot', parent: 'br_000', reason: 'roll', file_name: 'x br_000-1' } },
    { schema: 3, branch: { id: 'br_000-2', kind: 'snapshot', parent: 'br_000', reason: 'continue', file_name: 'x br_000-2' } },
    { schema: 3, branch: { id: 'br_000-1-1', kind: 'snapshot', parent: 'br_000-1', reason: 'edit', file_name: 'x br_000-1-1' } },
  ];
  const plan = planRenumberAfterDelete(metas, 'br_000-1', 'br_000');
  assert.equal(plan.maxSeq, 2);
  assert.deepEqual(plan.steps.map((s) => [s.branchId, s.newId, s.newParent]), [
    ['br_000-1-1', 'br_000-1', 'br_000'], // child of the deleted branch, adopted by the root
  ]);
});

test('branches: renumber plan is a no-op for root/invalid/highest deletions', () => {
  const metas = [
    { schema: 3, branch: { id: 'br_000', kind: 'active', parent: null, reason: 'root', file_name: 'root' } },
    { schema: 3, branch: { id: 'br_000-1', kind: 'snapshot', parent: 'br_000', reason: 'roll', file_name: 'x br_000-1' } },
  ];
  assert.deepEqual(planRenumberAfterDelete(metas, 'br_000', null), { steps: [], maxSeq: 0, touched: false }); // root
  assert.deepEqual(planRenumberAfterDelete(metas, 'bogus', null), { steps: [], maxSeq: 0, touched: false }); // invalid
  const highest = planRenumberAfterDelete(metas, 'br_000-1', 'br_000'); // deleting the only child
  assert.equal(highest.steps.length, 0);
  assert.equal(highest.maxSeq, 0); // bucket now empty -> next child restarts at 1
  assert.equal(highest.touched, true);
});

test('branches: renumber plan repairs pre-existing gaps and [FA]-suffixed names', () => {
  const metas = [
    { schema: 3, branch: { id: 'br_000', kind: 'active', parent: null, reason: 'root', file_name: 'Seraphina' } },
    { schema: 3, branch: { id: 'br_000-2', kind: 'snapshot', parent: 'br_000', reason: 'delete', file_name: 'Seraphina - delete 2026-08-02 br_000-2 [FA]' } },
    { schema: 3, branch: { id: 'br_000-3', kind: 'snapshot', parent: 'br_000', reason: 'edit', file_name: 'Seraphina - edit 2026-08-02 br_000-3 [FA]' } },
  ];
  const plan = planRenumberAfterDelete(metas, 'br_000-2', 'br_000');
  assert.equal(plan.maxSeq, 1);
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.steps[0], {
    branchId: 'br_000-3',
    newId: 'br_000-1',
    fileName: 'Seraphina - edit 2026-08-02 br_000-3 [FA]',
    newFileName: 'Seraphina - edit 2026-08-02 br_000-1 [FA]',
    newParent: 'br_000',
  });
});

test('branches: legacy flat ids migrate to the recursive scheme', () => {
  const metas = [
    { schema: 3, branch: { id: 'br_200', kind: 'active', parent: null, reason: 'root', file_name: 'Seraphina' } },
    { schema: 3, branch: { id: 'br_201', kind: 'snapshot', parent: 'br_200', reason: 'roll', file_name: 'Seraphina - [FA] roll 2026-08-02 br_201' } },
    { schema: 3, branch: { id: 'br_202', kind: 'snapshot', parent: 'br_200', reason: 'delete', file_name: 'Seraphina - [FA] delete 2026-08-02 br_202' } },
  ];
  const plan = planMigrateLegacyIds(metas);
  assert.equal(plan.migrated, true);
  assert.equal(plan.steps.length, 3);
  const byOld = Object.fromEntries(plan.steps.map((s) => [s.branchId, s]));
  assert.equal(byOld.br_200.newId, 'br_000');
  assert.equal(byOld.br_201.newId, 'br_000-1');
  assert.equal(byOld.br_202.newId, 'br_000-2');
  assert.equal(byOld.br_201.newFileName, 'Seraphina - [FA] roll 2026-08-02 br_000-1');
  assert.equal(byOld.br_201.newParent, 'br_000');
  // Already migrated -> no-op.
  const migrated = metas.map((m) => ({ ...m, branch: { ...m.branch, id: byOld[m.branch.id].newId, parent: byOld[m.branch.id].newParent } }));
  assert.equal(planMigrateLegacyIds(migrated).migrated, false);
});

test('panel-index: builds tree, resolves rollback target, serializes', () => {
  const index = PanelIndex.build([
    {
      schema: 3,
      branch: { id: 'br_200', kind: 'active', parent: null, reason: 'root', file_name: 'root.jsonl' },
      preview: '在酒馆门口，一个神秘身影',
    },
    {
      schema: 3,
      branch: { id: 'br_201', kind: 'snapshot', parent: 'br_200', source_floor: 2, reason: 'roll', file_name: 'snapshot_roll.jsonl' },
      preview: '你要不要来一杯？',
    },
    { schema: 3, branch: { id: 'br_202', kind: 'active', parent: 'br_201', source_floor: 2, reason: 'rescue', file_name: 'branch_continued.jsonl' } },
  ]);

  assert.deepEqual(index.rootIds, ['br_200']);
  assert.deepEqual(index.getChildren('br_200').map((n) => n.id), ['br_201']);
  assert.deepEqual(index.getChildren('br_201').map((n) => n.id), ['br_202']);
  assert.equal(index.resolveFileName('br_201'), 'snapshot_roll.jsonl');
  assert.deepEqual(index.getPath('br_202'), ['br_200', 'br_201', 'br_202']);
  assert.equal(index.get('br_200').preview, '在酒馆门口，一个神秘身影');
  assert.equal(index.get('br_201').preview, '你要不要来一杯？');
  assert.equal(index.get('br_202').preview, null);

  const restored = PanelIndex.fromJSON(index.toJSON());
  assert.deepEqual(restored.getPath('br_202'), ['br_200', 'br_201', 'br_202']);
  assert.equal(restored.get('br_200').preview, '在酒馆门口，一个神秘身影');
  assert.equal(restored.get('br_201').preview, '你要不要来一杯？');
  assert.equal(restored.get('br_202').preview, null);
});

test('panel-index: orphan detection for missing parent', () => {
  const index = PanelIndex.build([
    { schema: 3, branch: { id: 'br_300', kind: 'snapshot', parent: 'ghost', source_floor: 1, reason: 'roll', file_name: 'x.jsonl' } },
  ]);
  assert.deepEqual(index.orphans, ['br_300']);
  assert.deepEqual(index.rootIds, []);
});

test('invariants: clean tree passes, broken tree reports B2/B7/B8', () => {
  const clean = PanelIndex.build([
    { schema: 3, branch: { id: 'br_200', kind: 'active', parent: null, reason: 'root' } },
    { schema: 3, branch: { id: 'br_201', kind: 'snapshot', parent: 'br_200', source_floor: 1, reason: 'roll' } },
  ]);
  assert.deepEqual(checkInvariants(clean), []);

  const broken = new PanelIndex();
  broken.nodes.set('a', { id: 'a', parent: null, sourceFloor: null, children: [] });
  broken.nodes.set('b', { id: 'b', parent: 'a', sourceFloor: null, children: [] });
  broken.nodes.set('c', { id: 'c', parent: 'missing', sourceFloor: null, children: [] });
  broken.rootIds = ['a'];
  const violations = checkInvariants(broken);
  assert.ok(violations.some((v) => v.startsWith('B2')));
  assert.ok(violations.some((v) => v.startsWith('B7')));
  assert.ok(violations.some((v) => v.startsWith('B8')));
});

test('invariants: meta validation rejects malformed st_floor', () => {
  assert.deepEqual(validateBranchMeta({ schema: 3, branch: {} }), ['invalid st_floor meta']);
  assert.deepEqual(validateBranchMeta({ schema: 3, branch: { id: 'ok' } }), []);
  assert.equal(isValidBranchMeta({ schema: 3, branch: { id: 'ok' } }), true);
});
