<script>
  // A color field: a swatch that opens a picker with a color wheel (hue around, saturation outward), a brightness
  // slider, R / G / B fields, a hex field and quick picks. `value` is a hex color like '#2563eb', or '' when
  // `allowEmpty` (the field then shows `emptyLabel`, e.g. "Same as brand").
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';
  import { Check } from 'lucide-svelte';

  export let value = '';
  export let label = 'Color';
  export let presets = [];
  export let allowEmpty = false;
  export let emptyLabel = 'None';
  export let disabled = false;

  const dispatch = createEventDispatcher();
  let open = false;
  let root;
  let wheel;

  const HEX = /^#[0-9a-f]{6}$/i;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const toHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
  const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  function hsvToRgb(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5) * 255, f(3) * 255, f(1) * 255];
  }
  function rgbToHsv([r, g, b]) {
    const [rr, gg, bb] = [r / 255, g / 255, b / 255];
    const max = Math.max(rr, gg, bb);
    const d = max - Math.min(rr, gg, bb);
    let h = 0;
    if (d) {
      if (max === rr) h = ((gg - bb) / d) % 6;
      else if (max === gg) h = (bb - rr) / d + 2;
      else h = (rr - gg) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  // The picker works in HSV so dragging on the wheel never loses the hue at low saturation.
  let hsv = { h: 0, s: 0, v: 1 };
  $: current = HEX.test(value) ? value.toLowerCase() : '';
  $: rgb = current ? fromHex(current) : [255, 255, 255];
  $: hexText = current;

  function syncFromValue() {
    if (current) hsv = rgbToHsv(fromHex(current));
  }

  function set(hex) {
    value = hex;
    dispatch('change', hex);
  }
  const setHsv = (next) => {
    hsv = next;
    set(toHex(hsvToRgb(next.h, next.s, next.v)));
  };

  function toggle() {
    if (disabled) return;
    open = !open;
    if (open) syncFromValue();
  }

  function pick(event) {
    const box = wheel.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    const radius = box.width / 2;
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    setHsv({ h, s: clamp(Math.hypot(dx, dy) / radius, 0, 1), v: hsv.v || 1 });
  }
  function onPointerDown(event) {
    wheel.setPointerCapture(event.pointerId);
    pick(event);
  }
  function onPointerMove(event) {
    if (wheel.hasPointerCapture(event.pointerId)) pick(event);
  }

  function setChannel(index, raw) {
    const next = [...rgb];
    next[index] = clamp(Number(raw) || 0, 0, 255);
    const hex = toHex(next);
    hsv = rgbToHsv(next);
    set(hex);
  }
  function setHexText(raw) {
    const text = String(raw).trim();
    const full = /^#?[0-9a-f]{3}$/i.test(text)
      ? `#${[...text.replace('#', '')].map((c) => c + c).join('')}`
      : text.startsWith('#')
        ? text
        : `#${text}`;
    if (HEX.test(full)) {
      hsv = rgbToHsv(fromHex(full));
      set(full.toLowerCase());
    }
  }

  // The knob on the wheel: angle from the hue, distance from the saturation.
  $: knobX = 50 + Math.sin((hsv.h * Math.PI) / 180) * hsv.s * 50;
  $: knobY = 50 - Math.cos((hsv.h * Math.PI) / 180) * hsv.s * 50;
</script>

<svelte:window
  on:pointerdown={(event) => {
    if (open && root && !root.contains(event.target)) open = false;
  }}
  on:keydown={(event) => {
    if (open && event.key === 'Escape') open = false;
  }}
/>

<div class="cp" bind:this={root}>
  <button
    type="button"
    class="cp-field"
    {disabled}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={`${label}: ${current || emptyLabel}`}
    on:click={toggle}
  >
    <span class="cp-swatch" class:empty={!current} style:background={current || null}></span>
    <span class="cp-text">{current || emptyLabel}</span>
  </button>

  {#if open}
    <div class="cp-pop" role="dialog" aria-label={label} transition:fade={{ duration: 120 }}>
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="cp-wheel"
        bind:this={wheel}
        style:--v={hsv.v}
        on:pointerdown={onPointerDown}
        on:pointermove={onPointerMove}
      >
        <span class="cp-knob" style:left={`${knobX}%`} style:top={`${knobY}%`} style:background={current || 'white'}
        ></span>
      </div>
      <label class="cp-row">
        <span>Brightness</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(hsv.v * 100)}
          style:--hue-color={toHex(hsvToRgb(hsv.h, hsv.s, 1))}
          on:input={(event) => setHsv({ ...hsv, v: Number(event.currentTarget.value) / 100 })}
        />
      </label>
      <div class="cp-rgb">
        {#each ['R', 'G', 'B'] as channel, index (channel)}
          <label
            ><span>{channel}</span><input
              class="form-input"
              type="number"
              min="0"
              max="255"
              value={Math.round(rgb[index])}
              on:change={(event) => setChannel(index, event.currentTarget.value)}
            /></label
          >
        {/each}
        <label class="cp-hex"
          ><span>Hex</span><input
            class="form-input"
            maxlength="7"
            value={hexText}
            placeholder="e.g. 2563eb"
            on:change={(event) => setHexText(event.currentTarget.value)}
          /></label
        >
      </div>
      {#if presets.length || allowEmpty}
        <div class="cp-presets">
          {#if allowEmpty}
            <button type="button" class="cp-empty" class:on={!current} on:click={() => set('')}>{emptyLabel}</button>
          {/if}
          {#each presets as preset (preset)}
            <button
              type="button"
              class="cp-preset"
              style:background={preset}
              aria-label={`Use ${preset}`}
              on:click={() => {
                hsv = rgbToHsv(fromHex(preset));
                set(preset);
              }}>{#if preset === current}<Check size={13} />{/if}</button
            >
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cp {
    position: relative;
    display: inline-block;
  }
  .cp-field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
    padding: 0 var(--space-3) 0 0.35rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .cp-field:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  }
  .cp-swatch {
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 25%, transparent);
  }
  .cp-swatch.empty {
    background: repeating-linear-gradient(45deg, var(--surface-3) 0 4px, var(--surface-1) 4px 8px);
  }
  .cp-text {
    font-family: var(--font-mono-stack);
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  .cp-pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 50;
    display: grid;
    gap: var(--space-3);
    width: 18.5rem;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    box-shadow: var(--shadow-lg);
  }
  /* Hue goes around the circle and saturation grows outward; the dark layer is the brightness. */
  .cp-wheel {
    position: relative;
    justify-self: center;
    width: 12rem;
    aspect-ratio: 1;
    border-radius: 50%;
    background:
      radial-gradient(closest-side, hsl(0 0% 100%), transparent),
      conic-gradient(
        hsl(0 100% 50%),
        hsl(60 100% 50%),
        hsl(120 100% 50%),
        hsl(180 100% 50%),
        hsl(240 100% 50%),
        hsl(300 100% 50%),
        hsl(360 100% 50%)
      );
    cursor: crosshair;
    touch-action: none;
  }
  .cp-wheel::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: hsl(0 0% 0%);
    opacity: calc(1 - var(--v));
    pointer-events: none;
  }
  .cp-knob {
    position: absolute;
    z-index: 1;
    width: 1.1rem;
    height: 1.1rem;
    border: 2px solid hsl(0 0% 100%);
    border-radius: 50%;
    box-shadow: 0 0 0 1px hsl(0 0% 0% / 0.45);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .cp-row {
    display: grid;
    gap: 4px;
    color: var(--text-secondary);
    font-size: 0.75rem;
  }
  .cp-row input {
    width: 100%;
    accent-color: var(--hue-color);
  }
  .cp-rgb {
    display: grid;
    grid-template-columns: repeat(3, minmax(3.2rem, 1fr)) minmax(0, 1.7fr);
    gap: var(--space-1);
  }
  .cp-rgb label {
    display: grid;
    gap: 2px;
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  .cp-rgb input {
    min-width: 0;
    padding-inline: 0.3rem;
    appearance: textfield;
    font-family: var(--font-mono-stack);
    font-size: 0.8rem;
  }
  .cp-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .cp-preset {
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    border: 0;
    border-radius: 50%;
    color: hsl(0 0% 100%);
    box-shadow: inset 0 0 0 1px hsl(0 0% 0% / 0.25);
    cursor: pointer;
  }
  .cp-empty {
    min-height: 1.6rem;
    padding: 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .cp-empty.on {
    border-color: var(--accent);
    color: var(--text);
  }
</style>
