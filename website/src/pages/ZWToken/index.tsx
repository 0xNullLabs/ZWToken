import { Card, Tabs, Form, InputNumber, Input, Button, message, Space } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { useConnectWallet } from '@web3-onboard/react';
import { useIntl } from '@umijs/max';
import { ethers } from 'ethers';
import React, { useState } from 'react';

const { TabPane } = Tabs;

const ZWToken: React.FC = () => {
  const intl = useIntl();
  const [{ wallet }] = useConnectWallet();
  const [depositForm] = Form.useForm();
  const [withdrawForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [claimForm] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // 获取当前账户
  const account = wallet?.accounts?.[0]?.address;

  // 获取provider和signer
  const getProvider = () => {
    if (!wallet) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return null;
    }
    return new ethers.BrowserProvider(wallet.provider, 'any');
  };

  // Deposit操作
  const handleDeposit = async (values: { amount: number }) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    setLoading(true);
    try {
      const provider = getProvider();
      if (!provider) return;

      const signer = await provider.getSigner();
      
      // TODO: 导入合约配置
      const contractAddress = '0x0000000000000000000000000000000000000000'; // 替换为实际地址
      const contractABI = ['function deposit(uint256 amount) external'];
      
      const contract = new ethers.Contract(contractAddress, contractABI, signer);
      const tx = await contract.deposit(ethers.parseEther(values.amount.toString()));
      
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.deposit.submitting' }), 0);
      await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.deposit.success' }));
      depositForm.resetFields();
    } catch (error: any) {
      message.error(`${intl.formatMessage({ id: 'pages.zwtoken.deposit.failed' })}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Withdraw操作
  const handleWithdraw = async (values: { amount: number }) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    setLoading(true);
    try {
      const provider = getProvider();
      if (!provider) return;

      const signer = await provider.getSigner();
      
      // TODO: 导入合约配置
      const contractAddress = '0x0000000000000000000000000000000000000000'; // 替换为实际地址
      const contractABI = ['function withdraw(uint256 amount) external'];
      
      const contract = new ethers.Contract(contractAddress, contractABI, signer);
      const tx = await contract.withdraw(ethers.parseEther(values.amount.toString()));
      
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.withdraw.submitting' }), 0);
      await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.withdraw.success' }));
      withdrawForm.resetFields();
    } catch (error: any) {
      message.error(`${intl.formatMessage({ id: 'pages.zwtoken.withdraw.failed' })}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Transfer操作
  const handleTransfer = async (values: { privacyAddress: string; amount: number }) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    setLoading(true);
    try {
      const provider = getProvider();
      if (!provider) return;

      const signer = await provider.getSigner();
      
      // TODO: 导入合约配置
      const contractAddress = '0x0000000000000000000000000000000000000000'; // 替换为实际地址
      const contractABI = ['function transfer(address to, uint256 amount) external returns (bool)'];
      
      const contract = new ethers.Contract(contractAddress, contractABI, signer);
      const tx = await contract.transfer(
        values.privacyAddress,
        ethers.parseEther(values.amount.toString())
      );
      
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.transfer.submitting' }), 0);
      await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.transfer.success' }));
      transferForm.resetFields();
    } catch (error: any) {
      message.error(`${intl.formatMessage({ id: 'pages.zwtoken.transfer.failed' })}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Claim操作
  const handleClaim = async (values: any) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    setLoading(true);
    try {
      const provider = getProvider();
      if (!provider) return;

      const signer = await provider.getSigner();
      
      // TODO: 实现ZK proof生成逻辑
      // 这里需要调用ZK proof生成相关的代码
      message.info(intl.formatMessage({ id: 'pages.zwtoken.claim.generating' }));
      
      // TODO: 导入合约配置
      const contractAddress = '0x0000000000000000000000000000000000000000'; // 替换为实际地址
      const contractABI = [
        'function claim(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256 root, uint256 nullifier, address recipient, uint256 claimAmount) external',
      ];
      
      const contract = new ethers.Contract(contractAddress, contractABI, signer);
      
      // TODO: 生成实际的proof参数
      // 需要集成 client/merkle_proof_frontend.js 和 snarkjs
      // const generator = new ZKProofGenerator(contractAddress, provider);
      // const circuitInput = await generator.generateCircuitInput(values.secret, values.recipient, values.claimAmount);
      // const { proof, publicSignals } = await snarkjs.groth16.fullProve(...);
      
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.claim.submitting' }), 0);
      // const tx = await contract.claim(proof.pi_a, proof.pi_b, proof.pi_c, circuitInput.root, circuitInput.nullifier, values.recipient, ethers.parseEther(values.claimAmount.toString()));
      // await tx.wait();
      message.destroy();
      message.info(intl.formatMessage({ id: 'pages.zwtoken.claim.needImplement' }));
      claimForm.resetFields();
    } catch (error: any) {
      message.error(`${intl.formatMessage({ id: 'pages.zwtoken.claim.failed' })}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      header={{
        title: intl.formatMessage({ id: 'pages.zwtoken.title' }),
        subTitle: intl.formatMessage({ id: 'pages.zwtoken.subtitle' }),
      }}
    >
      <Card>
        <Tabs defaultActiveKey="deposit" type="card">
          <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.deposit' })} key="deposit">
            <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
              <Form
                form={depositForm}
                layout="vertical"
                onFinish={handleDeposit}
              >
                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.deposit.amount' })}
                  name="amount"
                  rules={[
                    { required: true, message: intl.formatMessage({ id: 'pages.zwtoken.deposit.amount.required' }) },
                    { type: 'number', min: 0.000001, message: intl.formatMessage({ id: 'pages.zwtoken.deposit.amount.min' }) },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    placeholder={intl.formatMessage({ id: 'pages.zwtoken.deposit.amount.placeholder' })}
                    precision={6}
                    min={0}
                  />
                </Form.Item>

                <Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={loading}>
                      {intl.formatMessage({ id: 'pages.zwtoken.deposit.button' })}
                    </Button>
                    <Button onClick={() => depositForm.resetFields()}>
                      {intl.formatMessage({ id: 'pages.zwtoken.deposit.reset' })}
                    </Button>
                  </Space>
                </Form.Item>
              </Form>

              <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
                <h4>{intl.formatMessage({ id: 'pages.zwtoken.deposit.tip.title' })}</h4>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.deposit.tip.1' })}</p>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.deposit.tip.2' })}</p>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.deposit.tip.3' })}</p>
              </div>
            </div>
          </TabPane>

          <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.withdraw' })} key="withdraw">
            <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
              <Form
                form={withdrawForm}
                layout="vertical"
                onFinish={handleWithdraw}
              >
                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.withdraw.amount' })}
                  name="amount"
                  rules={[
                    { required: true, message: intl.formatMessage({ id: 'pages.zwtoken.withdraw.amount.required' }) },
                    { type: 'number', min: 0.000001, message: intl.formatMessage({ id: 'pages.zwtoken.withdraw.amount.min' }) },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    placeholder={intl.formatMessage({ id: 'pages.zwtoken.withdraw.amount.placeholder' })}
                    precision={6}
                    min={0}
                  />
                </Form.Item>

                <Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={loading}>
                      {intl.formatMessage({ id: 'pages.zwtoken.withdraw.button' })}
                    </Button>
                    <Button onClick={() => withdrawForm.resetFields()}>
                      {intl.formatMessage({ id: 'pages.zwtoken.withdraw.reset' })}
                    </Button>
                  </Space>
                </Form.Item>
              </Form>

              <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
                <h4>{intl.formatMessage({ id: 'pages.zwtoken.withdraw.tip.title' })}</h4>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.withdraw.tip.1' })}</p>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.withdraw.tip.2' })}</p>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.withdraw.tip.3' })}</p>
              </div>
            </div>
          </TabPane>

          <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.transfer' })} key="transfer">
            <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
              <Form
                form={transferForm}
                layout="vertical"
                onFinish={handleTransfer}
              >
                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.transfer.privacyAddress' })}
                  name="privacyAddress"
                  rules={[
                    { required: true, message: intl.formatMessage({ id: 'pages.zwtoken.transfer.privacyAddress.required' }) },
                    { 
                      pattern: /^0x[a-fA-F0-9]{40}$/, 
                      message: intl.formatMessage({ id: 'pages.zwtoken.transfer.privacyAddress.invalid' })
                    },
                  ]}
                >
                  <Input
                    placeholder={intl.formatMessage({ id: 'pages.zwtoken.transfer.privacyAddress.placeholder' })}
                    maxLength={42}
                  />
                </Form.Item>

                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.transfer.amount' })}
                  name="amount"
                  rules={[
                    { required: true, message: intl.formatMessage({ id: 'pages.zwtoken.transfer.amount.required' }) },
                    { type: 'number', min: 0.000001, message: intl.formatMessage({ id: 'pages.zwtoken.transfer.amount.min' }) },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    placeholder={intl.formatMessage({ id: 'pages.zwtoken.transfer.amount.placeholder' })}
                    precision={6}
                    min={0}
                  />
                </Form.Item>

                <Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={loading}>
                      {intl.formatMessage({ id: 'pages.zwtoken.transfer.button' })}
                    </Button>
                    <Button onClick={() => transferForm.resetFields()}>
                      {intl.formatMessage({ id: 'pages.zwtoken.transfer.reset' })}
                    </Button>
                  </Space>
                </Form.Item>
              </Form>

              <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
                <h4>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.title' })}</h4>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.1' })}</p>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.2' })}</p>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.3' })}</p>
              </div>
            </div>
          </TabPane>

          <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.claim' })} key="claim">
            <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
              <Form
                form={claimForm}
                layout="vertical"
                onFinish={handleClaim}
              >
                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.claim.secret' })}
                  name="secret"
                  rules={[{ required: true, message: intl.formatMessage({ id: 'pages.zwtoken.claim.secret.required' }) }]}
                >
                  <Input.Password
                    placeholder={intl.formatMessage({ id: 'pages.zwtoken.claim.secret.placeholder' })}
                  />
                </Form.Item>

                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.claim.recipient' })}
                  name="recipient"
                  rules={[
                    { required: true, message: intl.formatMessage({ id: 'pages.zwtoken.claim.recipient.required' }) },
                    { 
                      pattern: /^0x[a-fA-F0-9]{40}$/, 
                      message: intl.formatMessage({ id: 'pages.zwtoken.claim.recipient.invalid' })
                    },
                  ]}
                >
                  <Input
                    placeholder={intl.formatMessage({ id: 'pages.zwtoken.claim.recipient.placeholder' })}
                    maxLength={42}
                  />
                </Form.Item>

                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.claim.amount' })}
                  name="claimAmount"
                  rules={[
                    { required: true, message: intl.formatMessage({ id: 'pages.zwtoken.claim.amount.required' }) },
                    { type: 'number', min: 0.000001, message: intl.formatMessage({ id: 'pages.zwtoken.claim.amount.min' }) },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    placeholder={intl.formatMessage({ id: 'pages.zwtoken.claim.amount.placeholder' })}
                    precision={6}
                    min={0}
                  />
                </Form.Item>

                <Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={loading}>
                      {intl.formatMessage({ id: 'pages.zwtoken.claim.button' })}
                    </Button>
                    <Button onClick={() => claimForm.resetFields()}>
                      {intl.formatMessage({ id: 'pages.zwtoken.claim.reset' })}
                    </Button>
                  </Space>
                </Form.Item>
              </Form>

              <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
                <h4>{intl.formatMessage({ id: 'pages.zwtoken.claim.tip.title' })}</h4>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.claim.tip.1' })}</p>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.claim.tip.2' })}</p>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.claim.tip.3' })}</p>
                <p>{intl.formatMessage({ id: 'pages.zwtoken.claim.tip.4' })}</p>
              </div>
            </div>
          </TabPane>
        </Tabs>
      </Card>

      {!account && (
        <Card style={{ marginTop: 16, background: '#fffbe6', borderColor: '#ffe58f' }}>
          <p style={{ margin: 0, textAlign: 'center' }}>
            {intl.formatMessage({ id: 'pages.zwtoken.connectWallet' })}
          </p>
        </Card>
      )}
    </PageContainer>
  );
};

export default ZWToken;

