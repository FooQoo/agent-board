import { visit } from 'unist-util-visit';

/** The component the sandbox shows in place of a part that is not registered. */
export const UNREGISTERED = 'AgboardUnregistered';

/** The parts MDX may use besides the standard HTML elements. Empty for now: parts are registered here. */
export const REGISTERED_COMPONENTS: Record<string, never> = {};

interface JsxNode {
  type: string;
  name: string | null;
  attributes: unknown[];
  children: unknown[];
}

/**
 * A remark plugin that swaps every JSX element that is neither a standard HTML element (lower case)
 * nor registered for `AgboardUnregistered` carrying the original name, so one missing part does not
 * stop the whole document.
 */
export function remarkUnregistered() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, (node) => {
      if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;
      const jsx = node as unknown as JsxNode;
      const name = jsx.name;
      if (name === null || /^[a-z]/.test(name) || name in REGISTERED_COMPONENTS) return;
      jsx.name = UNREGISTERED;
      jsx.attributes = [{ type: 'mdxJsxAttribute', name: 'name', value: name }];
      jsx.children = [];
    });
  };
}
