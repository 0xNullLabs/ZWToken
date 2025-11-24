import { Card, Tabs, Form, InputNumber, Input, Button, message, Space, Modal, Table, Checkbox } from 'antd';
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
  prepareCircuitInput,
  getCommitLeavesInBatches,
} from '@/utils/zkProof';
// @ts-ignore
import * as snarkjs from 'snarkjs';

const { TabPane } = Tabs;

// Sepolia 测试网的 chainId
const SEPOLIA_CHAIN_ID = 11155111;

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
  const [allowance, setAllowance] = useState<string>('0');
  const [depositAmount, setDepositAmount] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [seed, setSeed] = useState<string>('');
  const [secretList, setSecretList] = useState<
    Array<{ index: number; secret: string; amount: string; loading: boolean; isClaimed: boolean }>
  >([]);
  const [claimSeedModalVisible, setClaimSeedModalVisible] = useState(false);
  const [claimSecretList, setClaimSecretList] = useState<
    Array<{ index: number; secret: string; amount: string; loading: boolean; isClaimed: boolean }>
  >([]);
  
  // Deposit Directly Burn related states
  const [directBurn, setDirectBurn] = useState(false);
  const [depositSecretModalVisible, setDepositSecretModalVisible] = useState(false);
  const [depositSecretForm] = Form.useForm();
  const [depositSecretList, setDepositSecretList] = useState<
    Array<{ index: number; secret: string; amount: string; loading: boolean; isClaimed: boolean }>
  >([]);

  // 获取当前账户
  const account = wallet?.accounts?.[0]?.address;

  // 监听窗口大小变化
  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 576);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 获取代币小数位数的函数
  const fetchDecimals = React.useCallback(async () => {
    if (!wallet) return;

    try {
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
        console.log('网络不是 Sepolia，跳过获取 decimals');
        return;
      }

      const underlyingContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingToken,
        ['function decimals() view returns (uint8)'],
        provider,
      );
      const decimals = await underlyingContract.decimals();
      setTokenDecimals(Number(decimals));
      console.log('Token decimals:', decimals);
    } catch (error) {
      console.error('Failed to fetch token decimals:', error);
      // 保持默认值 18
    }
  }, [wallet]);

  // 刷新余额的函数
  const refreshBalances = React.useCallback(async () => {
    if (!wallet || !account) {
      setUsdcBalance('0');
      setZwusdcBalance('0');
      setAllowance('0');
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
        console.log('网络不是 Sepolia，跳过刷新余额');
        setUsdcBalance('0');
        setZwusdcBalance('0');
        setAllowance('0');
        return;
      }

      // 查询 USDC 余额
      const usdcContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingToken,
        CONTRACT_ABIS.ERC20,
        provider,
      );
      const usdcBal = await usdcContract.balanceOf(account);
      setUsdcBalance(ethers.formatUnits(usdcBal, tokenDecimals));

      // 查询 Allowance
      const allowanceBigInt = await usdcContract.allowance(account, CONTRACT_ADDRESSES.ZWERC20);
      setAllowance(ethers.formatUnits(allowanceBigInt, tokenDecimals));

      // 查询 ZWUSDC 余额
      const zwusdcContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        provider,
      );
      const zwusdcBal = await zwusdcContract.balanceOf(account);
      setZwusdcBalance(ethers.formatUnits(zwusdcBal, tokenDecimals));
    } catch (error) {
      console.error('Failed to fetch balances:', error);
    }
  }, [wallet, account, tokenDecimals]);

  // 检查并切换到 Sepolia 网络
  React.useEffect(() => {
    const checkNetwork = async () => {
      if (!wallet) return;

      try {
        // 不传入 chainId，获取实际连接的网络
        const provider = new ethers.BrowserProvider(wallet.provider);
        const network = await provider.getNetwork();

        console.log('当前连接的网络 chainId:', Number(network.chainId));

        if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
          message.error(
            `错误：当前连接的是 Chain ID ${Number(
              network.chainId,
            )} 的网络，请切换到 Sepolia 测试网 (Chain ID: 11155111)`,
            10,
          );

          // 尝试切换网络
          try {
            await wallet.provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }],
            });
            message.success('已成功切换到 Sepolia 测试网');
          } catch (switchError: any) {
            console.error('切换网络失败:', switchError);
            // 如果网络不存在，尝试添加网络
            if (switchError.code === 4902) {
              try {
                await wallet.provider.request({
                  method: 'wallet_addEthereumChain',
                  params: [
                    {
                      chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}`,
                      chainName: 'Sepolia Test Network',
                      nativeCurrency: {
                        name: 'Sepolia ETH',
                        symbol: 'SEP',
                        decimals: 18,
                      },
                      rpcUrls: ['https://sepolia.infura.io/v3/'],
                      blockExplorerUrls: ['https://sepolia.etherscan.io'],
                    },
                  ],
                });
                message.success('已添加并切换到 Sepolia 测试网');
              } catch (addError) {
                console.error('添加网络失败:', addError);
                message.error('无法添加 Sepolia 网络，请手动在钱包中添加');
              }
            } else {
              message.error('网络切换失败，请手动切换到 Sepolia 测试网');
            }
          }
        } else {
          console.log('✅ 已连接到 Sepolia 测试网');
        }
      } catch (error) {
        console.error('检查网络失败:', error);
      }
    };

    checkNetwork();

    // 监听网络变化事件
    if (wallet?.provider) {
      const handleChainChanged = (chainId: string) => {
        const decimalChainId = parseInt(chainId, 16);
        console.log('网络已切换到 chainId:', decimalChainId);

        if (decimalChainId !== SEPOLIA_CHAIN_ID) {
          message.warning(
            `当前网络已切换到 Chain ID ${decimalChainId}，请切换回 Sepolia 测试网 (Chain ID: 11155111)`,
          );
          // 清空余额显示
          setUsdcBalance('0');
          setZwusdcBalance('0');
        } else {
          message.success('✅ 已连接到 Sepolia 测试网，正在刷新数据...');
          // 刷新数据而不是刷新页面
          setTimeout(() => {
            fetchDecimals();
            refreshBalances();
          }, 500);
        }
      };

      wallet.provider.on('chainChanged', handleChainChanged);

      // 清理函数
      return () => {
        if (wallet?.provider?.removeListener) {
          wallet.provider.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
  }, [wallet, refreshBalances, fetchDecimals]);

  // 初始获取代币小数位数
  React.useEffect(() => {
    fetchDecimals();
  }, [fetchDecimals]);

  // 获取余额
  React.useEffect(() => {
    refreshBalances();

    // 每10秒刷新一次余额
    const interval = setInterval(refreshBalances, 10000);

    return () => clearInterval(interval);
  }, [refreshBalances]);

  // 获取provider和signer，并检查网络
  const getProvider = async () => {
    if (!wallet) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return null;
    }

    const provider = new ethers.BrowserProvider(wallet.provider);
    const network = await provider.getNetwork();

    if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
      message.error(
        `当前连接的是 Chain ID ${Number(
          network.chainId,
        )} 的网络，请切换到 Sepolia 测试网 (Chain ID: 11155111)`,
        5,
      );
      return null;
    }

    return provider;
  };

  // Generate Privacy Address from Secret
  const generatePrivacyAddress = async (secret: string) => {
    try {
      const poseidon = await buildPoseidon();
      const secretBigInt = BigInt(secret);
      const tokenId = 0n; // ERC-20 固定为 0

      // 参考 e2e.test.js 和 zkProof.ts 中的逻辑
      // addrScalar = Poseidon(8065, tokenId, secret)
      const addrScalar = poseidon.F.toString(poseidon([8065n, tokenId, secretBigInt]));
      const addr20 = BigInt(addrScalar) & ((1n << 160n) - 1n);
      const privacyAddress = ethers.getAddress('0x' + addr20.toString(16).padStart(40, '0'));

      return privacyAddress;
    } catch (error: any) {
      console.error('Error generating privacy address:', error);
      throw error;
    }
  };

  // Handle Burn button click - Open Secret input modal (Transfer page)
  const handleBurnClick = () => {
    setSecretModalVisible(true);
    // Reset state
    setSeed('');
    setSecretList([]);
  };

  // Handle Deposit Directly Burn button click
  const handleDepositBurnClick = () => {
    setDepositSecretModalVisible(true);
    // Reset state
    setSeed('');
    setDepositSecretList([]);
  };

  // Handle Deposit Secret confirmation - Generate Privacy Address
  const handleDepositSecretConfirm = async () => {
    try {
      const values = await depositSecretForm.validateFields();
      const privacyAddress = await generatePrivacyAddress(values.secret);

      // Set to Deposit form targetAddress field
      depositForm.setFieldsValue({ targetAddress: privacyAddress });

      message.success('Privacy Address generated and filled');
      setDepositSecretModalVisible(false);
      depositSecretForm.resetFields();
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error, do nothing
        return;
      }
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.error' })}: ${error.message}`,
      );
    }
  };

  // Select Secret for Deposit page
  const handleSelectDepositSecret = (secret: string) => {
    depositSecretForm.setFieldsValue({ secret });
    message.success('Secret selected');
  };

  // Generate Seed through wallet signature
  const handleGenerateBySeed = async () => {
    if (!wallet || !account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();

      // 构造签名消息
      const signMessage = `ZWToken: ${CONTRACT_ADDRESSES.ZWERC20}, chainId: ${network.chainId}`;

      // 请求签名
      const signature = await signer.signMessage(signMessage);

      // 签名结果作为Seed
      setSeed(signature);

      // 生成10个SecretBySeed
      const secrets: Array<{
        index: number;
        secret: string;
        amount: string;
        loading: boolean;
        isClaimed: boolean;
      }> = [];
      for (let i = 1; i <= 10; i++) {
        // Seed + 序号，做哈希
        const secretBySeed = ethers.keccak256(ethers.toUtf8Bytes(signature + i.toString()));
        // 转换为BigInt格式的字符串（去掉0x前缀）
        const secretBigInt = BigInt(secretBySeed).toString();
        secrets.push({
          index: i,
          secret: secretBigInt,
          amount: '-',
          loading: true,
          isClaimed: false,
        });
      }

      // Update the corresponding list based on which modal is open
      if (depositSecretModalVisible) {
        setDepositSecretList(secrets);
      } else {
        setSecretList(secrets);
      }
      message.success('Seed generated successfully! Querying amounts and status...');

      // 异步查询每个Secret对应的金额
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        provider,
      );

      // 获取链上所有的leafs（分批获取）
      const leafCount = await contract.getCommitLeafCount(0);
      console.log(`Found ${leafCount} commitment(s)`);

      let leaves: any[] = [];
      if (leafCount > 0n) {
        leaves = await getCommitLeavesInBatches(contract, 0, 0, leafCount, 100);
        console.log(`Retrieved ${leaves.length} leaf(s) from storage`);
      }

      // 逐个查询金额和 IsClaimed 状态
      for (let i = 0; i < secrets.length; i++) {
        try {
          const secret = secrets[i].secret;
          const { privacyAddress, nullifier } = await deriveFromSecret(secret);

          // Find matching privacy address in leaves to get first receipt amount
          let foundAmount = '0';
          for (const leaf of leaves) {
            if (leaf.to.toLowerCase() === privacyAddress.toLowerCase()) {
              foundAmount = ethers.formatUnits(leaf.amount, tokenDecimals);
              break;
            }
          }

          // Check if this address has ever received tokens
          const hasFirstReceipt = await contract.hasFirstReceiptRecorded(privacyAddress);
          
          let isClaimed = false;
          
          if (hasFirstReceipt) {
            // Address has received tokens before, check if claimed
            const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
            const isNullifierUsed = await contract.nullifierUsed(nullifierHex);
            
            // Check current balance of privacy address
            const currentBalance = await contract.balanceOf(privacyAddress);
            
            // Claimed if nullifier used OR balance is 0
            isClaimed = isNullifierUsed || currentBalance === 0n;
          } else {
            // Address has never received tokens, so it's available (not claimed)
            isClaimed = false;
          }

          // Update the corresponding list based on which modal is open
          if (depositSecretModalVisible) {
            setDepositSecretList((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? { ...item, amount: foundAmount, loading: false, isClaimed: isClaimed }
                  : item,
              ),
            );
          } else {
          setSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, amount: foundAmount, loading: false, isClaimed: isClaimed }
                : item,
            ),
          );
          }
        } catch (error) {
          console.error(`Failed to query Secret ${i + 1}:`, error);
          if (depositSecretModalVisible) {
            setDepositSecretList((prev) =>
              prev.map((item, idx) =>
                idx === i ? { ...item, amount: 'Query failed', loading: false, isClaimed: false } : item,
              ),
            );
          } else {
          setSecretList((prev) =>
            prev.map((item, idx) =>
                idx === i ? { ...item, amount: 'Query failed', loading: false, isClaimed: false } : item,
            ),
          );
          }
        }
      }

      message.success('Amount and status query completed!');
    } catch (error: any) {
      console.error('生成Seed失败:', error);
      message.error(`生成Seed失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Select a SecretBySeed
  const handleSelectSecret = (secret: string) => {
    secretForm.setFieldsValue({ secret });
    message.success('Secret selected');
  };

  // Click button to open modal and generate Seed immediately
  const handleClaimGenerateBySeedClick = async () => {
    if (!wallet || !account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    // 先打开模态框
    setClaimSeedModalVisible(true);
    setClaimSecretList([]);

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();

      // 构造签名消息
      const signMessage = `ZWToken: ${CONTRACT_ADDRESSES.ZWERC20}, chainId: ${network.chainId}`;

      // 请求签名
      const signature = await signer.signMessage(signMessage);

      // 生成10个SecretBySeed
      const secrets: Array<{
        index: number;
        secret: string;
        amount: string;
        loading: boolean;
        isClaimed: boolean;
      }> = [];
      for (let i = 1; i <= 10; i++) {
        // Seed + 序号，做哈希
        const secretBySeed = ethers.keccak256(ethers.toUtf8Bytes(signature + i.toString()));
        // 转换为BigInt格式的字符串（去掉0x前缀）
        const secretBigInt = BigInt(secretBySeed).toString();
        secrets.push({
          index: i,
          secret: secretBigInt,
          amount: '-',
          loading: true,
          isClaimed: false,
        });
      }

      setClaimSecretList(secrets);
      message.success('Seed 生成成功！正在查询金额和状态...');

      // 异步查询每个Secret对应的金额
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        provider,
      );

      // 获取链上所有的leafs（分批获取）
      const leafCount = await contract.getCommitLeafCount(0);
      console.log(`Found ${leafCount} commitment(s)`);

      let leaves: any[] = [];
      if (leafCount > 0n) {
        leaves = await getCommitLeavesInBatches(contract, 0, 0, leafCount, 100);
        console.log(`Retrieved ${leaves.length} leaf(s) from storage`);
      }

      // 逐个查询金额和 IsClaimed 状态
      for (let i = 0; i < secrets.length; i++) {
        try {
          const secret = secrets[i].secret;
          const { privacyAddress, nullifier } = await deriveFromSecret(secret);

          // Find matching privacy address in leaves to get first receipt amount
          let foundAmount = '0';
          for (const leaf of leaves) {
            if (leaf.to.toLowerCase() === privacyAddress.toLowerCase()) {
              foundAmount = ethers.formatUnits(leaf.amount, tokenDecimals);
              break;
            }
          }

          // Check if this address has ever received tokens
          const hasFirstReceipt = await contract.hasFirstReceiptRecorded(privacyAddress);
          
          let isClaimed = false;
          
          if (hasFirstReceipt) {
            // Address has received tokens before, check if claimed
            const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
            const isNullifierUsed = await contract.nullifierUsed(nullifierHex);
            
            // Check current balance of privacy address
            const currentBalance = await contract.balanceOf(privacyAddress);
            
            // Claimed if nullifier used OR balance is 0
            isClaimed = isNullifierUsed || currentBalance === 0n;
          } else {
            // Address has never received tokens, so it's available (not claimed)
            isClaimed = false;
          }

          // Update state
          setClaimSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, amount: foundAmount, loading: false, isClaimed: isClaimed }
                : item,
            ),
          );
        } catch (error) {
          console.error(`Failed to query Secret ${i + 1} amount:`, error);
          setClaimSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, amount: 'Query failed', loading: false, isClaimed: false } : item,
            ),
          );
        }
      }

      message.success('金额和状态查询完成！');
    } catch (error: any) {
      console.error('生成Seed失败:', error);
      message.error(`生成Seed失败: ${error.message}`);
      // 如果失败，关闭模态框
      setClaimSeedModalVisible(false);
    } finally {
      setLoading(false);
    }
  };

  // Select SecretBySeed for Claim page
  const handleSelectClaimSecret = (secret: string) => {
    claimForm.setFieldsValue({ secret });
    setClaimSeedModalVisible(false);
    message.success('Secret selected');
  };

  // Handle Secret confirmation - Generate Privacy Address
  const handleSecretConfirm = async () => {
    try {
      const values = await secretForm.validateFields();
      const privacyAddress = await generatePrivacyAddress(values.secret);

      // Set to Transfer form targetAddress field
      transferForm.setFieldsValue({ targetAddress: privacyAddress });

      message.success(intl.formatMessage({ id: 'pages.zwtoken.transfer.generateSuccess' }));
      setSecretModalVisible(false);
      secretForm.resetFields();
    } catch (error: any) {
      if (error.errorFields) {
        // 表单验证错误，不做处理
        return;
      }
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.generateFailed' })}: ${error.message}`,
      );
    }
  };

  // 判断是否需要 approve
  const needsApproval = React.useMemo(() => {
    if (!depositAmount || depositAmount <= 0) return false;
    return parseFloat(allowance) < depositAmount;
  }, [depositAmount, allowance]);

  // Deposit操作
  const handleDeposit = async (values: { amount: number; targetAddress?: string }) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    // If Directly Burn is enabled, check if targetAddress exists
    if (directBurn && !values.targetAddress) {
      message.error('Please generate or enter Target Address first');
      return;
    }

    setLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      // 使用配置文件中的合约地址
      const underlyingContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingToken,
        CONTRACT_ABIS.ERC20,
        signer,
      );

      // 使用正确的小数位数
      const depositAmountBigInt = ethers.parseUnits(values.amount.toString(), tokenDecimals);
      console.log(
        `Deposit amount: ${
          values.amount
        } tokens = ${depositAmountBigInt.toString()} units (${tokenDecimals} decimals)`,
      );

      const currentAllowance = await underlyingContract.allowance(
        account,
        CONTRACT_ADDRESSES.ZWERC20,
      );

      // 如果授权不足，只执行授权
      if (currentAllowance < depositAmountBigInt) {
        message.loading(intl.formatMessage({ id: 'pages.zwtoken.deposit.approving' }), 0);
        const approveTx = await underlyingContract.approve(
          CONTRACT_ADDRESSES.ZWERC20,
          depositAmountBigInt,
        );
        await approveTx.wait();
        message.destroy();
        message.success('Approve 成功！现在可以 Deposit 了');
        // 刷新余额和 allowance
        refreshBalances();
        setLoading(false);
        return;
      }

      // Execute depositTo
      const zwTokenContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        signer,
      );
      
      // Determine to address based on directBurn status
      const toAddress = directBurn && values.targetAddress ? values.targetAddress : account;
      const tx = await zwTokenContract.depositTo(toAddress, 0, depositAmountBigInt);

      message.loading(intl.formatMessage({ id: 'pages.zwtoken.deposit.submitting' }), 0);
      await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.deposit.success' }));
      depositForm.resetFields();
      setDepositAmount(null);
      setDirectBurn(false);
      // Refresh balances
      refreshBalances();
    } catch (error: any) {
      message.destroy();
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.deposit.failed' })}: ${error.message}`,
      );
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
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      // 使用配置文件中的合约地址
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        signer,
      );

      // 使用正确的小数位数
      const withdrawAmount = ethers.parseUnits(values.amount.toString(), tokenDecimals);
      console.log(
        `Withdraw amount: ${
          values.amount
        } tokens = ${withdrawAmount.toString()} units (${tokenDecimals} decimals)`,
      );

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
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.withdraw.failed' })}: ${error.message}`,
      );
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
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      // 使用配置文件中的合约地址
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        signer,
      );

      // 使用正确的小数位数
      const transferAmount = ethers.parseUnits(values.amount.toString(), tokenDecimals);
      console.log(
        `Transfer amount: ${
          values.amount
        } tokens = ${transferAmount.toString()} units (${tokenDecimals} decimals)`,
      );

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
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.failed' })}: ${error.message}`,
      );
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
    const hideLoading = message.loading(
      intl.formatMessage({ id: 'pages.zwtoken.claim.preparing' }),
      0,
    );

    try {
      const provider = await getProvider();
      if (!provider) {
        hideLoading();
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      // 使用配置文件中的合约地址
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        signer,
      );

      // === 步骤 1: 从 Secret 推导参数 ===
      console.log('Step 1: Deriving from secret...');
      const { privacyAddress, addr20, q, nullifier, secret } = await deriveFromSecret(
        values.secret,
      );
      console.log(`Privacy address: ${privacyAddress}`);
      console.log(`Nullifier: 0x${nullifier.toString(16)}`);

      // Check if nullifier is already used
      const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
      const isNullifierUsed = await contract.nullifierUsed(nullifierHex);
      if (isNullifierUsed) {
        hideLoading();
        message.error(intl.formatMessage({ id: 'pages.zwtoken.claim.nullifierUsed' }));
        return;
      }

      // Check if privacy address still has balance
      const currentBalance = await contract.balanceOf(privacyAddress);
      if (currentBalance === 0n) {
        hideLoading();
        message.error('Privacy Address has zero balance. Tokens may have been transferred already.');
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
      console.log(
        `Claim amount: ${
          values.claimAmount
        } tokens = ${claimAmount.toString()} units (${tokenDecimals} decimals)`,
      );

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
        remintAmount: BigInt(claimAmount),
        secret,
        addr20,
        commitAmount: userCommitment.amount,
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
          '/circuits/claim_first_receipt_final.zkey',
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
          claimAmount,
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
        message.error(
          `${intl.formatMessage({ id: 'pages.zwtoken.claim.failed' })}: ${proofError.message}`,
        );
      }
    } catch (error: any) {
      message.destroy();
      console.error('Claim error:', error);
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.claim.failed' })}: ${error.message}`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      header={{
        title: (
          <div
            style={{
              wordBreak: 'break-word',
              whiteSpace: 'normal',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxWidth: '100%',
            }}
          >
            <span>{intl.formatMessage({ id: 'pages.zwtoken.title' })}</span>
            <a
              href="https://ethereum-magicians.org/t/erc-8065-zero-knowledge-token-wrapper/26006"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#1890ff',
                fontSize: '18px',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              We propose <span style={{ textDecoration: 'underline' }}>ERC-8065</span>: Zero
              Knowledge Token Wrapper to achieve our goal.
            </a>
          </div>
        ),
      }}
    >
      <Card>
        {/* 余额显示区域 */}
        {account && (
          <div
            style={{
              marginBottom: 24,
              padding: '16px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-around',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div style={{ flex: '1 1 200px', minWidth: '200px' }}>
              <div
                style={{
                  fontSize: 14,
                  color: 'rgba(255, 255, 255, 0.8)',
                  marginBottom: 8,
                }}
              >
                {intl.formatMessage({ id: 'pages.zwtoken.balance.usdc' })}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: '#fff',
                  wordBreak: 'break-all',
                }}
              >
                {parseFloat(usdcBalance).toFixed(6)}{' '}
                <a
                  href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.UnderlyingToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#fff',
                    textDecoration: 'underline',
                    textDecorationColor: 'rgba(255, 255, 255, 0.6)',
                  }}
                >
                  USDC
                </a>
              </div>
            </div>

            {!isMobile && (
              <div
                style={{
                  width: 1,
                  height: 60,
                  background: 'rgba(255, 255, 255, 0.2)',
                }}
              />
            )}

            <div style={{ flex: '1 1 200px', minWidth: '200px' }}>
              <div
                style={{
                  fontSize: 14,
                  color: 'rgba(255, 255, 255, 0.8)',
                  marginBottom: 8,
                }}
              >
                {intl.formatMessage({ id: 'pages.zwtoken.balance.zwusdc' })}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: '#fff',
                  wordBreak: 'break-all',
                }}
              >
                {parseFloat(zwusdcBalance).toFixed(6)}{' '}
                <a
                  href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.ZWERC20}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#fff',
                    textDecoration: 'underline',
                    textDecorationColor: 'rgba(255, 255, 255, 0.6)',
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
              <Form form={depositForm} layout="vertical" onFinish={handleDeposit}>
                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.deposit.amount' })}
                  name="amount"
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.zwtoken.deposit.amount.required' }),
                    },
                    {
                      type: 'number',
                      min: 0.000001,
                      message: intl.formatMessage({ id: 'pages.zwtoken.deposit.amount.min' }),
                    },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    placeholder={intl.formatMessage({
                      id: 'pages.zwtoken.deposit.amount.placeholder',
                    })}
                    precision={6}
                    min={0}
                    onChange={(value) => setDepositAmount(value)}
                  />
                </Form.Item>

                {account && (
                  <div
                    style={{
                      marginTop: -16,
                      marginBottom: 16,
                      color: '#999',
                      fontSize: '12px',
                    }}
                  >
                    {intl.formatMessage({ id: 'pages.zwtoken.deposit.currentAllowance' })}:{' '}
                    {parseFloat(allowance).toFixed(6)} USDC
                  </div>
                )}

                <Form.Item>
                  <Checkbox
                    checked={directBurn}
                    onChange={(e) => {
                      setDirectBurn(e.target.checked);
                      if (!e.target.checked) {
                        depositForm.setFieldsValue({ targetAddress: undefined });
                      }
                    }}
                  >
                    Directly Burn (Deposit to provably burnable address)
                  </Checkbox>
                </Form.Item>

                {directBurn && (
                  <Form.Item
                    label="Target Address"
                    name="targetAddress"
                    rules={[
                      {
                        required: true,
                        message: 'Please enter or generate Target Address',
                      },
                      {
                        pattern: /^0x[a-fA-F0-9]{40}$/,
                        message: 'Please enter a valid Ethereum address',
                      },
                    ]}
                  >
                    <Input
                      placeholder="Enter address or click button to generate Privacy Address"
                      maxLength={42}
                      addonAfter={
                        <Button
                          type="link"
                          onClick={handleDepositBurnClick}
                          style={{ padding: 0, height: 'auto' }}
                        >
                          Generate By Seed
                        </Button>
                      }
                    />
                  </Form.Item>
                )}

                <Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={loading}>
                      {needsApproval
                        ? 'Approve'
                        : intl.formatMessage({ id: 'pages.zwtoken.deposit.button' })}
                    </Button>
                    <Button
                      onClick={() => {
                        depositForm.resetFields();
                        setDepositAmount(null);
                        setDirectBurn(false);
                      }}
                    >
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
                {directBurn && (
                  <p style={{ color: '#faad14', fontWeight: 'bold' }}>
                    Note: When Directly Burn is enabled, tokens will be deposited to the specified Privacy Address. Only the holder of the corresponding Secret can Claim them.
                  </p>
                )}
              </div>
            </div>
          </TabPane>

          <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.withdraw' })} key="withdraw">
            <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
              <Form form={withdrawForm} layout="vertical" onFinish={handleWithdraw}>
                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.withdraw.amount' })}
                  name="amount"
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.zwtoken.withdraw.amount.required' }),
                    },
                    {
                      type: 'number',
                      min: 0.000001,
                      message: intl.formatMessage({ id: 'pages.zwtoken.withdraw.amount.min' }),
                    },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    placeholder={intl.formatMessage({
                      id: 'pages.zwtoken.withdraw.amount.placeholder',
                    })}
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
              <Form form={transferForm} layout="vertical" onFinish={handleTransfer}>
                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.transfer.targetAddress' })}
                  name="targetAddress"
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({
                        id: 'pages.zwtoken.transfer.targetAddress.required',
                      }),
                    },
                    {
                      pattern: /^0x[a-fA-F0-9]{40}$/,
                      message: intl.formatMessage({
                        id: 'pages.zwtoken.transfer.targetAddress.invalid',
                      }),
                    },
                  ]}
                >
                  <Input
                    placeholder={intl.formatMessage({
                      id: 'pages.zwtoken.transfer.targetAddress.placeholder',
                    })}
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
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.zwtoken.transfer.amount.required' }),
                    },
                    {
                      type: 'number',
                      min: 0.000001,
                      message: intl.formatMessage({ id: 'pages.zwtoken.transfer.amount.min' }),
                    },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    placeholder={intl.formatMessage({
                      id: 'pages.zwtoken.transfer.amount.placeholder',
                    })}
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
              <Form form={claimForm} layout="vertical" onFinish={handleClaim}>
                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.claim.secret' })}
                  name="secret"
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.zwtoken.claim.secret.required' }),
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={intl.formatMessage({
                      id: 'pages.zwtoken.claim.secret.placeholder',
                    })}
                    addonAfter={
                      <Button
                        type="link"
                        onClick={handleClaimGenerateBySeedClick}
                        style={{ padding: 0, height: 'auto' }}
                      >
                        {intl.formatMessage({ id: 'pages.zwtoken.claim.generateBySeed' })}
                      </Button>
                    }
                  />
                </Form.Item>

                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.claim.recipient' })}
                  name="recipient"
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.zwtoken.claim.recipient.required' }),
                    },
                    {
                      pattern: /^0x[a-fA-F0-9]{40}$/,
                      message: intl.formatMessage({ id: 'pages.zwtoken.claim.recipient.invalid' }),
                    },
                  ]}
                >
                  <Input
                    placeholder={intl.formatMessage({
                      id: 'pages.zwtoken.claim.recipient.placeholder',
                    })}
                    maxLength={42}
                  />
                </Form.Item>

                <Form.Item
                  label={intl.formatMessage({ id: 'pages.zwtoken.claim.amount' })}
                  name="claimAmount"
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({ id: 'pages.zwtoken.claim.amount.required' }),
                    },
                    {
                      type: 'number',
                      min: 0.000001,
                      message: intl.formatMessage({ id: 'pages.zwtoken.claim.amount.min' }),
                    },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    placeholder={intl.formatMessage({
                      id: 'pages.zwtoken.claim.amount.placeholder',
                    })}
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

      {/* Deposit Directly Burn Secret Modal - Generate Privacy Address */}
      <Modal
        title="Generate Privacy Address (Deposit Directly Burn)"
        open={depositSecretModalVisible}
        onOk={handleDepositSecretConfirm}
        onCancel={() => {
          setDepositSecretModalVisible(false);
          depositSecretForm.resetFields();
          setSeed('');
          setDepositSecretList([]);
        }}
        okText={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.ok' })}
        cancelText={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.cancel' })}
        width={900}
      >
        <Form form={depositSecretForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.secret' })}
            name="secret"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.zwtoken.transfer.secretModal.secret.required',
                }),
              },
              {
                pattern: /^\d+$/,
                message: intl.formatMessage({
                  id: 'pages.zwtoken.transfer.secretModal.secret.invalid',
                }),
              },
            ]}
          >
            <Input
              placeholder={intl.formatMessage({
                id: 'pages.zwtoken.transfer.secretModal.secret.placeholder',
              })}
              addonAfter={
                <Button
                  type="link"
                  onClick={handleGenerateBySeed}
                  loading={loading}
                  style={{ padding: 0, height: 'auto' }}
                >
                  {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.generateBySeed' })}
                </Button>
              }
            />
          </Form.Item>
          <p style={{ color: '#666', fontSize: '12px' }}>
            {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.tip' })}
          </p>
        </Form>

        {/* 显示SecretBySeed列表 */}
        {depositSecretList.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h4>
              {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.seedList.title' })}
            </h4>
            <Table
              dataSource={depositSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.index',
                  }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 80,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.secret',
                  }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 300,
                  ellipsis: true,
                  render: (text: string) => (
                    <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {text.substring(0, 20)}...{text.substring(text.length - 20)}
                    </span>
                  ),
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.amount',
                  }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 150,
                  align: 'right',
                  render: (amount: string, record) => {
                    if (record.loading) {
                      return (
                        <span style={{ color: '#999' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.checking',
                          })}
                        </span>
                      );
                    }
                    if (amount === 'Query failed') {
                      return (
                        <span style={{ color: '#ff4d4f' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.failed',
                          })}
                        </span>
                      );
                    }
                    const amountNum = parseFloat(amount);
                    if (amountNum > 0) {
                      return (
                        <span style={{ color: '#faad14', fontWeight: 'bold' }}>
                          {parseFloat(amount).toFixed(6)} ZWUSDC
                        </span>
                      );
                    }
                    // Show different message based on isClaimed status
                    if (record.isClaimed) {
                      return <span style={{ color: '#999' }}>0 ZWUSDC (Claimed)</span>;
                    }
                    return (
                      <span style={{ color: '#52c41a' }}>
                        0 ZWUSDC (
                        {intl.formatMessage({
                          id: 'pages.zwtoken.transfer.secretModal.seedList.available',
                        })}
                        )
                      </span>
                    );
                  },
                },
                {
                  title: 'IsClaimed',
                  dataIndex: 'isClaimed',
                  key: 'isClaimed',
                  width: 100,
                  align: 'center',
                  render: (isClaimed: boolean, record) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (isClaimed) {
                      return <span style={{ color: '#999', fontWeight: 'bold' }}>Claimed</span>;
                    }
                    return <span style={{ color: '#52c41a' }}>Available</span>;
                  },
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.action',
                  }),
                  key: 'action',
                  width: 100,
                  align: 'center',
                  render: (_, record) => {
                    const amountNum = parseFloat(record.amount);
                    const hasAmount =
                      !record.loading && record.amount !== 'Query failed' && amountNum > 0;
                    return (
                      <Button
                        type={hasAmount ? 'default' : 'primary'}
                        size="small"
                        onClick={() => handleSelectDepositSecret(record.secret)}
                        disabled={record.loading || hasAmount}
                        title={
                          hasAmount
                            ? intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.hasAmount',
                              })
                            : intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                              })
                        }
                      >
                        {intl.formatMessage({
                          id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                        })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.seedList.tip' })}
            </p>
          </div>
        )}
      </Modal>

      {/* Secret Modal - Generate Privacy Address (Transfer) */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.title' })}
        open={secretModalVisible}
        onOk={handleSecretConfirm}
        onCancel={() => {
          setSecretModalVisible(false);
          secretForm.resetFields();
          setSeed('');
          setSecretList([]);
        }}
        okText={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.ok' })}
        cancelText={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.cancel' })}
        width={900}
      >
        <Form form={secretForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.secret' })}
            name="secret"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.zwtoken.transfer.secretModal.secret.required',
                }),
              },
              {
                pattern: /^\d+$/,
                message: intl.formatMessage({
                  id: 'pages.zwtoken.transfer.secretModal.secret.invalid',
                }),
              },
            ]}
          >
            <Input
              placeholder={intl.formatMessage({
                id: 'pages.zwtoken.transfer.secretModal.secret.placeholder',
              })}
              addonAfter={
                <Button
                  type="link"
                  onClick={handleGenerateBySeed}
                  loading={loading}
                  style={{ padding: 0, height: 'auto' }}
                >
                  {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.generateBySeed' })}
                </Button>
              }
            />
          </Form.Item>
          <p style={{ color: '#666', fontSize: '12px' }}>
            {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.tip' })}
          </p>
        </Form>

        {/* 显示SecretBySeed列表 */}
        {secretList.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h4>
              {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.seedList.title' })}
            </h4>
            <Table
              dataSource={secretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.index',
                  }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 80,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.secret',
                  }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 300,
                  ellipsis: true,
                  render: (text: string) => (
                    <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {text.substring(0, 20)}...{text.substring(text.length - 20)}
                    </span>
                  ),
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.amount',
                  }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 150,
                  align: 'right',
                  render: (amount: string, record) => {
                    if (record.loading) {
                      return (
                        <span style={{ color: '#999' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.checking',
                          })}
                        </span>
                      );
                    }
                    if (amount === 'Query failed') {
                      return (
                        <span style={{ color: '#ff4d4f' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.failed',
                          })}
                        </span>
                      );
                    }
                    const amountNum = parseFloat(amount);
                    if (amountNum > 0) {
                      return (
                        <span style={{ color: '#faad14', fontWeight: 'bold' }}>
                          {parseFloat(amount).toFixed(6)} ZWUSDC
                        </span>
                      );
                    }
                    // Show different message based on isClaimed status
                    if (record.isClaimed) {
                      return <span style={{ color: '#999' }}>0 ZWUSDC (Claimed)</span>;
                    }
                    return (
                      <span style={{ color: '#52c41a' }}>
                        0 ZWUSDC (
                        {intl.formatMessage({
                          id: 'pages.zwtoken.transfer.secretModal.seedList.available',
                        })}
                        )
                      </span>
                    );
                  },
                },
                {
                  title: 'IsClaimed',
                  dataIndex: 'isClaimed',
                  key: 'isClaimed',
                  width: 100,
                  align: 'center',
                  render: (isClaimed: boolean, record) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (isClaimed) {
                      return <span style={{ color: '#999', fontWeight: 'bold' }}>Claimed</span>;
                    }
                    return <span style={{ color: '#52c41a' }}>Available</span>;
                  },
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.action',
                  }),
                  key: 'action',
                  width: 100,
                  align: 'center',
                  render: (_, record) => {
                    const amountNum = parseFloat(record.amount);
                    const hasAmount =
                      !record.loading && record.amount !== 'Query failed' && amountNum > 0;
                    return (
                      <Button
                        type={hasAmount ? 'default' : 'primary'}
                        size="small"
                        onClick={() => handleSelectSecret(record.secret)}
                        disabled={record.loading || hasAmount}
                        title={
                          hasAmount
                            ? intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.hasAmount',
                              })
                            : intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                              })
                        }
                      >
                        {intl.formatMessage({
                          id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                        })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.seedList.tip' })}
            </p>
          </div>
        )}
      </Modal>

      {/* Claim页面的Seed生成Modal */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.title' })}
        open={claimSeedModalVisible}
        onCancel={() => {
          setClaimSeedModalVisible(false);
          setClaimSecretList([]);
        }}
        footer={[
          <Button key="close" onClick={() => setClaimSeedModalVisible(false)}>
            {intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.close' })}
          </Button>,
        ]}
        width={1000}
      >
        {claimSecretList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <p>{intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.waiting' })}</p>
          </div>
        ) : (
          <div>
            <Table
              dataSource={claimSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 400, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.index' }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 80,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.secret' }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 300,
                  ellipsis: true,
                  render: (text: string) => (
                    <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {text.substring(0, 20)}...{text.substring(text.length - 20)}
                    </span>
                  ),
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.amount' }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 150,
                  align: 'right',
                  render: (amount: string, record) => {
                    if (record.loading) {
                      return (
                        <span style={{ color: '#999' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.checking' })}
                        </span>
                      );
                    }
                    if (amount === 'Query failed') {
                      return (
                        <span style={{ color: '#ff4d4f' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.failed' })}
                        </span>
                      );
                    }
                    const amountNum = parseFloat(amount);
                    if (amountNum > 0) {
                      return (
                        <span style={{ color: '#52c41a', fontWeight: 'bold' }}>
                          {parseFloat(amount).toFixed(6)} ZWUSDC
                        </span>
                      );
                    }
                    // Show different message based on isClaimed status
                    if (record.isClaimed) {
                      return <span style={{ color: '#999' }}>0 ZWUSDC (Claimed)</span>;
                    }
                    return <span style={{ color: '#52c41a' }}>0 ZWUSDC (Available)</span>;
                  },
                },
                {
                  title: 'IsClaimed',
                  dataIndex: 'isClaimed',
                  key: 'isClaimed',
                  width: 100,
                  align: 'center',
                  render: (isClaimed: boolean, record) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (isClaimed) {
                      return <span style={{ color: '#999', fontWeight: 'bold' }}>Claimed</span>;
                    }
                    return <span style={{ color: '#52c41a' }}>Available</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.action' }),
                  key: 'action',
                  width: 100,
                  align: 'center',
                  render: (_, record) => (
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => handleSelectClaimSecret(record.secret)}
                      disabled={record.loading}
                    >
                      {intl.formatMessage({ id: 'pages.zwtoken.claim.seedModal.select' })}
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default ZWToken;
