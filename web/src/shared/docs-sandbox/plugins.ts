import remarkGfm from 'remark-gfm';
import { remarkUnregistered } from './unregistered';

/**
 * The remark plugins an MDX document runs with: GitHub Flavored Markdown (tables, task lists,
 * strikethrough, autolinks), as in a `.md` file, then the swap of the parts that are not registered.
 */
export const REMARK_PLUGINS = [remarkGfm, remarkUnregistered];
