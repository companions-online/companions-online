import { describe, it, expect } from 'vitest';
import { ClientAction } from '@shared/actions.js';
import { MetaKey } from '@shared/entity-meta.js';
import { createTestScene } from './harness.js';
import { attachKeyboardControls } from '@client-webgl/controls/keyboard.js';

describe('entityMeta sync', () => {
  it('onEntityMeta populates scene.entityMeta', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'entityMeta', entityId: 42, key: MetaKey.Name, value: 'elsyian' });
    expect(scene.entityMeta.get(42)?.get(MetaKey.Name)).toBe('elsyian');
  });

  it('empty value clears the key', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'entityMeta', entityId: 42, key: MetaKey.Name, value: 'foo' });
    conn.deliver({ type: 'entityMeta', entityId: 42, key: MetaKey.Name, value: '' });
    expect(scene.entityMeta.has(42)).toBe(false);
  });

  it('entity removal prunes meta', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'entityMeta', entityId: 42, key: MetaKey.Name, value: 'foo' });
    expect(scene.entityMeta.has(42)).toBe(true);
    conn.deliver({
      type: 'worldDelta',
      data: { tick: 1, entityUpdates: [], entityRemovals: [42], tileUpdates: [] },
    });
    expect(scene.entityMeta.has(42)).toBe(false);
  });
});

describe('keyboard /command parsing', () => {
  function makeFakeCanvas(): { canvas: HTMLCanvasElement; fire: (key: string) => void } {
    let listener: ((ev: KeyboardEvent) => void) | null = null;
    const canvas = {
      addEventListener: (type: string, fn: (ev: KeyboardEvent) => void) => {
        if (type === 'keydown') listener = fn;
      },
    } as unknown as HTMLCanvasElement;
    const fire = (key: string) => {
      if (!listener) throw new Error('keydown listener not attached');
      listener({ key, preventDefault: () => {}, ctrlKey: false, altKey: false, metaKey: false } as unknown as KeyboardEvent);
    };
    return { canvas, fire };
  }

  function typeSeq(fire: (key: string) => void, s: string): void {
    for (const ch of s) fire(ch);
  }

  it('plain message submits as Say', async () => {
    const { scene, conn } = await createTestScene();
    const { canvas, fire } = makeFakeCanvas();
    const state = attachKeyboardControls(canvas, conn, scene);

    fire('Enter');
    expect(state.chatActive).toBe(true);
    typeSeq(fire, 'hello world');
    fire('Enter');

    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0].action).toBe(ClientAction.Say);
    expect((conn.sent[0] as any).message).toBe('hello world');
  });

  it('/nick foo submits as ServerCommand', async () => {
    const { scene, conn } = await createTestScene();
    const { canvas, fire } = makeFakeCanvas();
    attachKeyboardControls(canvas, conn, scene);

    fire('Enter');
    typeSeq(fire, '/nick foo');
    fire('Enter');

    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0].action).toBe(ClientAction.ServerCommand);
    expect((conn.sent[0] as any).command).toBe('nick');
    expect((conn.sent[0] as any).parameter).toBe('foo');
  });

  it('/command with no parameter submits with empty parameter', async () => {
    const { scene, conn } = await createTestScene();
    const { canvas, fire } = makeFakeCanvas();
    attachKeyboardControls(canvas, conn, scene);

    fire('Enter');
    typeSeq(fire, '/who');
    fire('Enter');

    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0].action).toBe(ClientAction.ServerCommand);
    expect((conn.sent[0] as any).command).toBe('who');
    expect((conn.sent[0] as any).parameter).toBe('');
  });

  it('/command with multi-word parameter preserves spaces', async () => {
    const { scene, conn } = await createTestScene();
    const { canvas, fire } = makeFakeCanvas();
    attachKeyboardControls(canvas, conn, scene);

    fire('Enter');
    typeSeq(fire, '/say hello world how are you');
    fire('Enter');

    expect(conn.sent).toHaveLength(1);
    expect((conn.sent[0] as any).parameter).toBe('hello world how are you');
  });

  it('I toggles inventory overlay; Esc closes; held stack drops on close', async () => {
    const { scene, conn } = await createTestScene();
    const { canvas, fire } = makeFakeCanvas();
    attachKeyboardControls(canvas, conn, scene);

    fire('i');
    expect(scene.overlay.kind).toBe('inventory');
    fire('i');
    expect(scene.overlay.kind).toBe('none');

    // Open, fake a held stack, close with Esc → expect a Drop with quantity.
    fire('i');
    scene.heldStack = { itemId: 42, blueprintId: 1, quantity: 3, source: 'inventory' };
    fire('Escape');
    expect(scene.overlay.kind).toBe('none');
    expect(scene.heldStack).toBeNull();
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0].action).toBe(ClientAction.Drop);
    expect((conn.sent[0] as any).itemId).toBe(42);
    expect((conn.sent[0] as any).quantity).toBe(3);
  });
});
