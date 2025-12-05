import React from 'react';
import { Button, Dropdown, Space } from 'antd';
import { WalletOutlined, UserOutlined, DisconnectOutlined } from '@ant-design/icons';
import { useConnectWallet, useSetChain } from '@web3-onboard/react';
import type { MenuProps } from 'antd';

const ConnectWallet: React.FC = () => {
  const [{ wallet, connecting }, connect, disconnect] = useConnectWallet();
  const [{ connectedChain }] = useSetChain();

  const handleConnect = async () => {
    await connect();
  };

  const handleDisconnect = async () => {
    if (wallet) {
      await disconnect({ label: wallet.label });
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const items: MenuProps['items'] = wallet
    ? [
        {
          key: 'address',
          icon: <UserOutlined />,
          label: (
            <div>
              <div style={{ fontSize: 12, color: '#999' }}>Address</div>
              <div>{formatAddress(wallet.accounts[0].address)}</div>
            </div>
          ),
        },
        {
          key: 'chain',
          icon: <WalletOutlined />,
          label: (
            <div>
              <div style={{ fontSize: 12, color: '#999' }}>Network</div>
              <div>{connectedChain?.id ? `Chain ID: ${connectedChain.id}` : 'Unknown Network'}</div>
            </div>
          ),
        },
        {
          type: 'divider',
        },
        {
          key: 'disconnect',
          icon: <DisconnectOutlined />,
          label: 'Disconnect',
          onClick: handleDisconnect,
          danger: true,
        },
      ]
    : [];

  if (!wallet) {
    return (
      <Button type="primary" icon={<WalletOutlined />} onClick={handleConnect} loading={connecting}>
        Connect Wallet
      </Button>
    );
  }

  return (
    <Dropdown menu={{ items }} placement="bottomRight">
      <Button type="primary" icon={<WalletOutlined />}>
        <Space>{formatAddress(wallet.accounts[0].address)}</Space>
      </Button>
    </Dropdown>
  );
};

export default ConnectWallet;
