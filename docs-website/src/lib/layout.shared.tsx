import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, asset, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // JSX supported
      title: <img src={asset('/logo.png')} alt={appName} style={{ height: 24, width: 'auto' }} />,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
