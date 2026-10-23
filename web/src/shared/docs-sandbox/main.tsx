import { evaluate } from '@mdx-js/mdx';
import { Component, type ReactNode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as runtime from 'react/jsx-runtime';
import { isRenderMessage, type SandboxReply, type SandboxRenderMessage } from './protocol';
import { REGISTERED_COMPONENTS, remarkUnregistered, UNREGISTERED } from './unregistered';

// This page runs the MDX of a document. It is embedded in an iframe without `allow-same-origin`, so
// it cannot reach the board's page, storage or token; its own CSP (see the server) forbids every
// connection. It only listens to the window that embeds it and answers it.

function post(reply: SandboxReply) {
  window.parent.postMessage(reply, '*');
}

const notice = {
  border: '1px dashed #b45309',
  borderRadius: 6,
  padding: '2px 8px',
  background: '#fef3c7',
  color: '#78350f',
  font: '13px system-ui, sans-serif',
} as const;

const errorBox = {
  border: '1px solid #b91c1c',
  borderRadius: 8,
  padding: '10px 12px',
  background: '#fee2e2',
  color: '#7f1d1d',
  font: '13px system-ui, sans-serif',
  whiteSpace: 'pre-wrap',
} as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ErrorBox({ label, message }: { label: string; message: string }) {
  useEffect(() => post({ type: 'error', message }), [message]);
  return (
    <div role="alert" style={errorBox}>
      {label}: {message}
    </div>
  );
}

/** Catches an exception thrown while the MDX renders (a failing expression), so only the frame shows it. */
class Boundary extends Component<
  { label: string; children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { message: messageOf(error) };
  }
  render() {
    return this.state.message === null ? (
      this.props.children
    ) : (
      <ErrorBox label={this.props.label} message={this.state.message} />
    );
  }
}

const root = createRoot(document.getElementById('root') as HTMLElement);
let serial = 0;

async function show({ source, labels }: SandboxRenderMessage) {
  const mine = ++serial;
  const Unregistered = ({ name }: { name: string }) => (
    <span role="note" style={notice}>
      {labels.unregistered}: {name}
    </span>
  );
  let content: ReactNode;
  try {
    const { default: Content } = await evaluate(source, {
      ...runtime,
      remarkPlugins: [remarkUnregistered],
    });
    content = <Content components={{ ...REGISTERED_COMPONENTS, [UNREGISTERED]: Unregistered }} />;
  } catch (error) {
    content = <ErrorBox label={labels.runtimeError} message={messageOf(error)} />;
  }
  if (mine !== serial) return;
  root.render(<Boundary label={labels.runtimeError}>{content}</Boundary>);
  requestAnimationFrame(() => post({ type: 'rendered', height: document.body.scrollHeight }));
}

window.addEventListener('message', (event) => {
  // Only the board page that embeds this one may send it MDX.
  if (event.source !== window.parent || !isRenderMessage(event.data)) return;
  void show(event.data);
});

// A link must not take the page away from the sandbox.
document.addEventListener('click', (event) => {
  if ((event.target as Element | null)?.closest('a')) event.preventDefault();
});

new ResizeObserver(() => post({ type: 'height', height: document.body.scrollHeight })).observe(
  document.body,
);
post({ type: 'ready' });
