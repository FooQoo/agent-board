import { redirectForInitialViewport } from './routing';

redirectForInitialViewport(window.innerWidth, window.location.href, (url) => {
  window.location.replace(url);
});
