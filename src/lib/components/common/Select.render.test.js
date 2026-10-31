import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Select from './Select.svelte';

describe('Select', () => {
  it('can let the button wrap a long choice instead of cutting it off', () => {
    const { body } = render(Select, { props: { wrapText: true, value: 'a' } });
    expect(body).toContain('wrap-text');
    expect(render(Select, { props: { value: 'a' } }).body).not.toContain('wrap-text');
  });
});
