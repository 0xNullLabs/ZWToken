import { Card, Tabs, Form, InputNumber, Input, Button, message, Space, Modal } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { useConnectWallet } from '@web3-onboard/react';
import { useIntl } from '@umijs/max';
import { ethers } from 'ethers';
import React, { useState } from 'react';
import { buildPoseidon } from 'circomlibjs';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '@/config/contracts';

const { TabPane } = Tabs;

const ZWToken: React.FC = () => {
  const intl = useIntl();
  const [{ wallet }] = useConnectWallet();
  const [depositForm] = Form.useForm();
  const [withdrawForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [claimForm] = Form.useForm();
  const [secretForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [secretModalVisible, setSecretModalVisible] = useState(false);

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

  // 从Secret生成Privacy Address
  const generatePrivacyAddress = async (secret: string) => {
    try {
      const poseidon = await buildPoseidon();
      const secretBigInt = BigInt(secret);
      
      // 参考 e2e.test.js 中的逻辑
      const addrScalar = poseidon.F.toString(poseidon([secretBigInt]));
      const addr20 = BigInt(addrScalar) & ((1n << 160n) - 1n);
      const privacyAddress = ethers.getAddress(
        '0x' + addr20.toString(16).padStart(40, '0')
      );
      
      return privacyAddress;
    } catch (error: any) {
      console.error('Error generating privacy address:', error);
      throw error;
    }
  };

  // 处理Burn按钮点击 - 打开Secret输入框
  const handleBurnClick = () => {
    setSecretModalVisible(true);
  };

  // 处理Secret确认 - 生成Privacy Address
  const handleSecretConfirm = async () => {
    try {
      const values = await secretForm.validateFields();
      const privacyAddress = await generatePrivacyAddress(values.secret);
      
      // 设置到Transfer表单的targetAddress字段
      transferForm.setFieldsValue({ targetAddress: privacyAddress });
      
      message.success(intl.formatMessage({ id: 'pages.zwtoken.transfer.generateSuccess' }));
      setSecretModalVisible(false);
      secretForm.resetFields();
    } catch (error: any) {
      if (error.errorFields) {
        // 表单验证错误，不做处理
        return;
      }
      message.error(`${intl.formatMessage({ id: 'pages.zwtoken.transfer.generateFailed' })}: ${error.message}`);
    }
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
      
      // 使用配置文件中的合约地址
      const underlyingContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingToken,
        CONTRACT_ABIS.ERC20,
        signer
      );
      
      const depositAmount = ethers.parseEther(values.amount.toString());
      const currentAllowance = await underlyingContract.allowance(account, CONTRACT_ADDRESSES.ZWToken);
      
      // 如果授权不足，先授权
      if (currentAllowance < depositAmount) {
        message.loading(intl.formatMessage({ id: 'pages.zwtoken.deposit.approving' }), 0);
        const approveTx = await underlyingContract.approve(CONTRACT_ADDRESSES.ZWToken, depositAmount);
        await approveTx.wait();
        message.destroy();
      }
      
      // 执行 deposit
      const zwTokenContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWToken,
        CONTRACT_ABIS.ZWToken,
        signer
      );
      const tx = await zwTokenContract.deposit(depositAmount);
      
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.deposit.submitting' }), 0);
      await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.deposit.success' }));
      depositForm.resetFields();
    } catch (error: any) {
      message.destroy();
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
      
      // 使用配置文件中的合约地址
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWToken,
        CONTRACT_ABIS.ZWToken,
        signer
      );
      const tx = await contract.withdraw(ethers.parseEther(values.amount.toString()));
      
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.withdraw.submitting' }), 0);
      await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.withdraw.success' }));
      withdrawForm.resetFields();
    } catch (error: any) {
      message.destroy();
      message.error(`${intl.formatMessage({ id: 'pages.zwtoken.withdraw.failed' })}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Transfer操作
  const handleTransfer = async (values: { targetAddress: string; amount: number }) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    setLoading(true);
    try {
      const provider = getProvider();
      if (!provider) return;

      const signer = await provider.getSigner();
      
      // 使用配置文件中的合约地址
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWToken,
        CONTRACT_ABIS.ZWToken,
        signer
      );
      const tx = await contract.transfer(
        values.targetAddress,
        ethers.parseEther(values.amount.toString())
      );
      
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.transfer.submitting' }), 0);
      await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.transfer.success' }));
      transferForm.resetFields();
    } catch (error: any) {
      message.destroy();
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
      
      // 使用配置文件中的合约地址
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWToken,
        CONTRACT_ABIS.ZWToken,
        signer
      );
      
      // TODO: 生成实际的proof参数
      // 需要集成以下步骤：
      // 1. 从链上获取所有 commitments (通过 getLeafRange)
      // 2. 重建 Merkle tree
      // 3. 生成 Merkle proof
      // 4. 使用 snarkjs 生成 ZK proof
      // 参考: test/e2e.test.js 中的完整流程
      
      message.destroy();
      message.info(intl.formatMessage({ id: 'pages.zwtoken.claim.needImplement' }));
      
      // 示例调用（需要实际的 proof 参数）：
      // const tx = await contract.claim(
      //   proof.a,
      //   proof.b,
      //   proof.c,
      //   root,
      //   nullifier,
      //   values.recipient,
      //   ethers.parseEther(values.claimAmount.toString())
      // );
      // await tx.wait();
      
      claimForm.resetFields();
    } catch (error: any) {
      message.destroy();
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
                  label={intl.formatMessage({ id: 'pages.zwtoken.transfer.targetAddress' })}
                  name="targetAddress"
                  rules={[
                    { required: true, message: intl.formatMessage({ id: 'pages.zwtoken.transfer.targetAddress.required' }) },
                    { 
                      pattern: /^0x[a-fA-F0-9]{40}$/, 
                      message: intl.formatMessage({ id: 'pages.zwtoken.transfer.targetAddress.invalid' })
                    },
                  ]}
                >
                  <Input
                    placeholder={intl.formatMessage({ id: 'pages.zwtoken.transfer.targetAddress.placeholder' })}
                    maxLength={42}
                    addonAfter={
                      <Button 
                        type="link" 
                        onClick={handleBurnClick}
                        style={{ padding: 0, height: 'auto' }}
                      >
                        {intl.formatMessage({ id: 'pages.zwtoken.transfer.burn' })}
                      </Button>
                    }
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
                <p>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.4' })}</p>
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

      {/* Secret Modal - 生成Privacy Address */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.title' })}
        open={secretModalVisible}
        onOk={handleSecretConfirm}
        onCancel={() => {
          setSecretModalVisible(false);
          secretForm.resetFields();
        }}
        okText={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.ok' })}
        cancelText={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.cancel' })}
      >
        <Form form={secretForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.secret' })}
            name="secret"
            rules={[
              { required: true, message: intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.secret.required' }) },
              { pattern: /^\d+$/, message: intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.secret.invalid' }) }
            ]}
          >
            <Input
              placeholder={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.secret.placeholder' })}
            />
          </Form.Item>
          <p style={{ color: '#666', fontSize: '12px' }}>
            {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.tip' })}
          </p>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default ZWToken;

