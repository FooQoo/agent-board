import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MermaidDiagram } from '../../src/components/markdown/MermaidDiagram';
import { selectLocale } from '../../src/i18n';

const { initialize, draw } = vi.hoisted(() => ({
  initialize: vi.fn(),
  draw: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: { initialize, render: draw } }));

const root = document.documentElement;

beforeEach(() => {
  selectLocale('en');
  initialize.mockClear();
  draw.mockReset();
  draw.mockImplementation(async (id: string, source: string) => ({
    svg: `<svg data-id="${id}" data-length="${source.length}"></svg>`,
  }));
});

afterEach(() => {
  cleanup();
  root.style.removeProperty('--r-accent');
});

describe('MermaidDiagram', () => {
  it('shows a loading line, then the drawn diagram', async () => {
    const { container } = render(<MermaidDiagram source={'flowchart TD\n  P1 --> Q1'} />);
    expect(screen.getByText('Drawing the diagram…')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy());
    expect(screen.queryByText('Drawing the diagram…')).toBeNull();
  });

  it('draws the diagram again when the page theme changes, and keeps it for other changes', async () => {
    const { container } = render(<MermaidDiagram source={'flowchart TD\n  P2 --> Q2'} />);
    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy());
    expect(draw).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.style.setProperty('--r-accent', '#ff0000');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(2));
    const variables = initialize.mock.calls.at(-1)?.[0].themeVariables as Record<string, string>;
    expect(variables.primaryBorderColor).toBe('#ff0000');
  });

  it('shows one sentence with the reason and the notation when the notation is wrong', async () => {
    draw.mockImplementation(async () => {
      throw new Error('Parse error on line 1:\nflowchart TD\nExpecting something');
    });
    const { container } = render(<MermaidDiagram source={'flowchart TD\n  ???'} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The diagram cannot be drawn: Parse error on line 1:');
    expect(container.querySelector('pre code')?.textContent).toBe('flowchart TD\n  ???');
    expect(container.querySelector('svg')).toBeNull();
  });
});
