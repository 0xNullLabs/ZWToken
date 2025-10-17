import { Card, Tabs, Form, InputNumber, Input, Button, message, Space, Modal } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { useConnectWallet } from '@web3-onboard/react';
import { useIntl } from '@umijs/max';
import { ethers } from 'ethers';
import React, { useState } from 'react';
import { buildPoseidon } from 'circomlibjs';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '@/config/contracts';
import { 
  deriveFromSecret, 
  rebuildMerkleTree, 
  findUserCommitment,
  prepareCircuitInput 
} from '@/utils/zkProof';
// @ts-ignore
import * as snarkjs from 'snarkjs';

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
  const [tokenDecimals, setTokenDecimals] = useState<number>(18); // 默认 18 位，实际会动态查询
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [zwusdcBalance, setZwusdcBalance] = useState<string>('0');

  // 获取当前账户
  const account = wallet?.accounts?.[0]?.address;

  // 获取代币小数位数
  React.useEffect(() => {
    const fetchDecimals = async () => {
      if (!wallet) return;
      
      try {
        const provider = new ethers.BrowserProvider(wallet.provider, 'any');
        const underlyingContract = new ethers.Contract(
          CONTRACT_ADDRESSES.UnderlyingToken,
          ['function decimals() view returns (uint8)'],
          provider
        );
        const decimals = await underlyingContract.decimals();
        setTokenDecimals(Number(decimals));
        console.log('Token decimals:', decimals);
      } catch (error) {
        console.error('Failed to fetch token decimals:', error);
        // 保持默认值 18
      }
    };
    
    fetchDecimals();
  }, [wallet]);

  // 刷新余额的函数
  const refreshBalances = React.useCallback(async () => {
    if (!wallet || !account) {
      setUsdcBalance('0');
      setZwusdcBalance('0');
      return;
    }
    
    try {
      const provider = new ethers.BrowserProvider(wallet.provider, 'any');
      
      // 查询 USDC 余额
      const usdcContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingToken,
        CONTRACT_ABIS.ERC20,
        provider
      );
      const usdcBal = await usdcContract.balanceOf(account);
      setUsdcBalance(ethers.formatUnits(usdcBal, tokenDecimals));
      
      // 查询 ZWUSDC 余额
      const zwusdcContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWToken,
        CONTRACT_ABIS.ZWToken,
        provider
      );
      const zwusdcBal = await zwusdcContract.balanceOf(account);
      setZwusdcBalance(ethers.formatUnits(zwusdcBal, tokenDecimals));
    } catch (error) {
      console.error('Failed to fetch balances:', error);
    }
  }, [wallet, account, tokenDecimals]);

  // 获取余额
  React.useEffect(() => {
    refreshBalances();
    
    // 每10秒刷新一次余额
    const interval = setInterval(refreshBalances, 10000);
    
    return () => clearInterval(interval);
  }, [refreshBalances]);

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
      
      // 使用正确的小数位数
      const depositAmount = ethers.parseUnits(values.amount.toString(), tokenDecimals);
      console.log(`Deposit amount: ${values.amount} tokens = ${depositAmount.toString()} units (${tokenDecimals} decimals)`);
      
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
      // 刷新余额
      refreshBalances();
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
      
      // 使用正确的小数位数
      const withdrawAmount = ethers.parseUnits(values.amount.toString(), tokenDecimals);
      console.log(`Withdraw amount: ${values.amount} tokens = ${withdrawAmount.toString()} units (${tokenDecimals} decimals)`);
      
      const tx = await contract.withdraw(withdrawAmount);
      
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.withdraw.submitting' }), 0);
      await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.withdraw.success' }));
      withdrawForm.resetFields();
      // 刷新余额
      refreshBalances();
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
      
      // 使用正确的小数位数
      const transferAmount = ethers.parseUnits(values.amount.toString(), tokenDecimals);
      console.log(`Transfer amount: ${values.amount} tokens = ${transferAmount.toString()} units (${tokenDecimals} decimals)`);
      
      const tx = await contract.transfer(values.targetAddress, transferAmount);
      
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.transfer.submitting' }), 0);
      await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.transfer.success' }));
      transferForm.resetFields();
      // 刷新余额
      refreshBalances();
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
    const hideLoading = message.loading(intl.formatMessage({ id: 'pages.zwtoken.claim.preparing' }), 0);
    
    try {
      const provider = getProvider();
      if (!provider) {
        hideLoading();
        return;
      }

      const signer = await provider.getSigner();
      
      // 使用配置文件中的合约地址
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWToken,
        CONTRACT_ABIS.ZWToken,
        signer
      );
      
      // === 步骤 1: 从 Secret 推导参数 ===
      console.log('Step 1: Deriving from secret...');
      const { privacyAddress, addr20, q, nullifier, secret } = await deriveFromSecret(values.secret);
      console.log(`Privacy address: ${privacyAddress}`);
      console.log(`Nullifier: 0x${nullifier.toString(16)}`);
      
      // 检查 nullifier 是否已使用
      const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
      const isNullifierUsed = await contract.nullifierUsed(nullifierHex);
      if (isNullifierUsed) {
        hideLoading();
        message.error(intl.formatMessage({ id: 'pages.zwtoken.claim.nullifierUsed' }));
        return;
      }
      
      // === 步骤 2: 从链上重建 Merkle tree ===
      hideLoading();
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.claim.rebuildingTree' }), 0);
      console.log('Step 2: Rebuilding Merkle tree from chain...');
      
      const poseidon = await buildPoseidon();
      const tree = await rebuildMerkleTree(contract, poseidon);
      
      const onchainRoot = await contract.root();
      const localRoot = '0x' + tree.root.toString(16).padStart(64, '0');
      console.log(`On-chain root: ${onchainRoot}`);
      console.log(`Local root:    ${localRoot}`);
      
      if (localRoot !== onchainRoot) {
        message.destroy();
        message.error(intl.formatMessage({ id: 'pages.zwtoken.claim.rootMismatch' }));
        return;
      }
      
      // === 步骤 3: 查找用户的 commitment ===
      message.destroy();
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.claim.findingCommitment' }), 0);
      console.log('Step 3: Finding user commitment...');
      
      const userCommitment = await findUserCommitment(contract, privacyAddress, poseidon);
      if (!userCommitment) {
        message.destroy();
        message.error(intl.formatMessage({ id: 'pages.zwtoken.claim.commitmentNotFound' }));
        return;
      }
      
      console.log(`Found commitment at index ${userCommitment.index}`);
      console.log(`First amount: ${ethers.formatUnits(userCommitment.amount, tokenDecimals)}`);
      
      // 验证 claim amount 不超过 first amount
      const claimAmount = ethers.parseUnits(values.claimAmount.toString(), tokenDecimals);
      console.log(`Claim amount: ${values.claimAmount} tokens = ${claimAmount.toString()} units (${tokenDecimals} decimals)`);
      
      if (claimAmount > userCommitment.amount) {
        message.destroy();
        message.error(intl.formatMessage({ id: 'pages.zwtoken.claim.amountExceeded' }));
        return;
      }
      
      // === 步骤 4: 生成 Merkle proof ===
      message.destroy();
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.claim.generatingProof' }), 0);
      console.log('Step 4: Generating Merkle proof...');
      
      const merkleProof = tree.getProof(userCommitment.index);
      console.log(`Merkle proof generated (${merkleProof.pathElements.length} elements)`);
      
      // === 步骤 5: 准备电路输入 ===
      const circuitInput = prepareCircuitInput({
        root: tree.root,
        nullifier,
        recipient: values.recipient,
        claimAmount: BigInt(claimAmount),
        secret,
        addr20,
        firstAmount: userCommitment.amount,
        q,
        merkleProof,
      });
      
      console.log('Circuit input prepared:', circuitInput);
      
      // === 步骤 6: 生成 ZK proof ===
      message.destroy();
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.claim.generatingZKProof' }), 0);
      console.log('Step 6: Generating ZK proof (this may take 10-30 seconds)...');
      
      try {
        // 生成真实的 ZK proof
        const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
          circuitInput,
          '/circuits/claim_first_receipt.wasm',
          '/circuits/claim_first_receipt_final.zkey'
        );
        
        console.log('✅ ZK proof generated!');
        console.log('Public signals:', publicSignals);
        
        // 格式化为 Solidity calldata
        const calldata = await snarkjs.groth16.exportSolidityCallData(zkProof, publicSignals);
        const calldataJson = JSON.parse('[' + calldata + ']');
        
        const solidityProof = {
          a: calldataJson[0],
          b: calldataJson[1],
          c: calldataJson[2],
        };
        
        console.log('✅ Proof formatted for Solidity');
        
        // === 步骤 7: 提交 claim 交易 ===
        message.destroy();
        message.loading(intl.formatMessage({ id: 'pages.zwtoken.claim.submitting' }), 0);
        console.log('Step 7: Submitting claim transaction...');
        
        const tx = await contract.claim(
          solidityProof.a,
          solidityProof.b,
          solidityProof.c,
          localRoot,
          nullifierHex,
          values.recipient,
          claimAmount
        );
        
        console.log('Transaction submitted, waiting for confirmation...');
        const receipt = await tx.wait();
        
        message.destroy();
        message.success(intl.formatMessage({ id: 'pages.zwtoken.claim.success' }));
        console.log(`✅ Claim succeeded! Gas used: ${receipt.gasUsed}`);
        
        claimForm.resetFields();
        // 刷新余额
        refreshBalances();
      } catch (proofError: any) {
        message.destroy();
        console.error('ZK proof generation or claim error:', proofError);
        message.error(`${intl.formatMessage({ id: 'pages.zwtoken.claim.failed' })}: ${proofError.message}`);
      }
    } catch (error: any) {
      message.destroy();
      console.error('Claim error:', error);
      message.error(`${intl.formatMessage({ id: 'pages.zwtoken.claim.failed' })}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      header={{
        title: intl.formatMessage({ id: 'pages.zwtoken.title' }),
        subTitle: "Zero Knowledge Wrapper USDC",
      }}
    >
      <Card>
        {/* 余额显示区域 */}
        {account && (
          <div style={{ 
            marginBottom: 24, 
            padding: '16px 24px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: 8,
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            gap: 24
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ 
                fontSize: 14, 
                color: 'rgba(255, 255, 255, 0.8)',
                marginBottom: 8
              }}>
                USDC 余额
              </div>
              <div style={{ 
                fontSize: 24, 
                fontWeight: 'bold',
                color: '#fff'
              }}>
                {parseFloat(usdcBalance).toFixed(6)}{' '}
                <a 
                  href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.UnderlyingToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ 
                    color: '#fff',
                    textDecoration: 'underline',
                    textDecorationColor: 'rgba(255, 255, 255, 0.6)'
                  }}
                >
                  USDC
                </a>
              </div>
            </div>
            
            <div style={{ 
              width: 1, 
              height: 60, 
              background: 'rgba(255, 255, 255, 0.2)' 
            }} />
            
            <div style={{ flex: 1 }}>
              <div style={{ 
                fontSize: 14, 
                color: 'rgba(255, 255, 255, 0.8)',
                marginBottom: 8
              }}>
                ZWUSDC 余额
              </div>
              <div style={{ 
                fontSize: 24, 
                fontWeight: 'bold',
                color: '#fff'
              }}>
                {parseFloat(zwusdcBalance).toFixed(6)}{' '}
                <a 
                  href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.ZWToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ 
                    color: '#fff',
                    textDecoration: 'underline',
                    textDecorationColor: 'rgba(255, 255, 255, 0.6)'
                  }}
                >
                  ZWUSDC
                </a>
              </div>
            </div>
          </div>
        )}
        
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

