import { Footer, Question, SelectLang } from '@/components';
import ConnectWallet from '@/components/ConnectWallet';
import Web3Provider from '@/components/Web3Provider';
import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RunTimeLayoutConfig } from '@umijs/max';
import React from 'react';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';

const isDev = process.env.NODE_ENV === 'development';

/**
 * @name rootContainer
 * @description Wrap Web3Provider around the entire application
 */
export function rootContainer(container: React.ReactNode) {
  return <Web3Provider>{container}</Web3Provider>;
}

/**
 * @see  https://umijs.org/zh-CN/plugins/plugin-initial-state
 * */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
}> {
  return {
    settings: defaultSettings as Partial<LayoutSettings>,
  };
}

// ProLayout supported API https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({ initialState, setInitialState }) => {
  return {
    actionsRender: () => [
      <Question key="doc" />,
      <SelectLang key="SelectLang" />,
      <ConnectWallet key="ConnectWallet" />,
    ],
    footerRender: () => <Footer />,
    menuHeaderRender: undefined,
    // Custom 403 page
    // unAccessible: <div>unAccessible</div>,
    // Add a loading state
    childrenRender: (children) => {
      return (
        <>
          {children}
          {isDev && (
            <SettingDrawer
              disableUrlParams
              enableDarkTheme
              settings={initialState?.settings}
              onSettingChange={(settings) => {
                setInitialState((preInitialState) => ({
                  ...preInitialState,
                  settings,
                }));
              }}
            />
          )}
        </>
      );
    },
    ...initialState?.settings,
  };
};

/**
 * @name request configuration for error handling
 * Based on axios and ahooks useRequest, provides unified network request and error handling.
 * @doc https://umijs.org/docs/max/request#configuration
 */
export const request = {
  ...errorConfig,
};
