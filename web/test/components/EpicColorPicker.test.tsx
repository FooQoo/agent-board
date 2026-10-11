import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EpicColorPicker, hexToHsv, hsvToHex } from '../../src/components/editor/EpicColorPicker';
import { selectLocale } from '../../src/i18n';

afterEach(cleanup);

function Host() {
  const [color, setColor] = useState('#7C3AED');
  return (
    <>
      <EpicColorPicker color={color} onChange={setColor} disabled={false} />
      <output>{color}</output>
    </>
  );
}

describe('epic color palette', () => {
  it('round-trips primary colors, greys and the epic color', () => {
    for (const hex of [
      '#000000',
      '#FFFFFF',
      '#888888',
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#7C3AED',
      '#2563EB',
    ]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('previews only complete HEX values and supports hue and map keyboard controls', async () => {
    selectLocale('en');
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose a label color' }));
    const hex = screen.getByLabelText('HEX');
    fireEvent.change(hex, { target: { value: '#00' } });
    expect(screen.getByRole('status').textContent).toBe('#7C3AED');
    fireEvent.blur(hex);
    expect((hex as HTMLInputElement).value).toBe('#7C3AED');
    fireEvent.change(hex, { target: { value: '#ff0000' } });
    expect(screen.getByRole('status').textContent).toBe('#FF0000');
    fireEvent.change(screen.getByRole('slider', { name: 'Hue' }), { target: { value: '120' } });
    expect(screen.getByRole('status').textContent).toBe('#00FF00');
    const map = screen.getByRole('slider', { name: 'Saturation and brightness' });
    fireEvent.keyDown(map, { key: 'ArrowDown', shiftKey: true });
    expect(screen.getByRole('status').textContent).toBe('#00E600');
    fireEvent.keyDown(map, { key: 'ArrowLeft', shiftKey: true });
    expect(screen.getByRole('status').textContent).toBe('#17E617');
  });
});
