import {
  Card,
  Tabs,
  Form,
  InputNumber,
  Input,
  Button,
  message,
  Modal,
  Table,
  Checkbox,
  Tooltip,
  Tag,
  Empty,
} from 'antd';
import { CopyOutlined, CloseOutlined, InfoCircleOutlined } from '@ant-design/icons';
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

// Sepolia testnet chainId
const SEPOLIA_CHAIN_ID = 11155111;

// LocalStorage keys for Last Burn information
const LAST_BURN_STORAGE_KEY = 'zwerc721_last_burn_info';

const ZWERC721: React.FC = () => {
  const intl = useIntl();
  const [{ wallet }, connect] = useConnectWallet();
  const [simpleDepositForm] = Form.useForm(); // Simple Mode Burn form
  const [advancedDepositForm] = Form.useForm(); // Advanced Mode Wrap form
  const [withdrawForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [remintForm] = Form.useForm();
  const [advancedRemintForm] = Form.useForm();
  const [secretForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [secretModalVisible, setSecretModalVisible] = useState(false);
  const [nftBalance, setNftBalance] = useState<number>(0);
  const [zwNftBalance, setZwNftBalance] = useState<number>(0);
  const [userTokenIds, setUserTokenIds] = useState<number[]>([]);
  const [zwUserTokenIds, setZwUserTokenIds] = useState<number[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [seed, setSeed] = useState<string>('');
  const [secretList, setSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; claimedTokenIds: number[] }>
  >([]);
  const [remintSeedModalVisible, setRemintSeedModalVisible] = useState(false);
  const [remintSecretList, setRemintSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; claimedTokenIds: number[] }>
  >([]);

  // Advanced Mode Remint states
  const [advancedRemintSeedModalVisible, setAdvancedRemintSeedModalVisible] = useState(false);
  const [advancedRemintSecretList, setAdvancedRemintSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; claimedTokenIds: number[] }>
  >([]);

  // Store selected tokenId for remint
  const [selectedRemintTokenId, setSelectedRemintTokenId] = useState<number | null>(null);

  // Transaction hash states for displaying submitted transactions
  const [simpleBurnTxHash, setSimpleBurnTxHash] = useState<string | null>(null);
  const [simpleRemintTxHash, setSimpleRemintTxHash] = useState<string | null>(null);
  const [advancedDepositTxHash, setAdvancedDepositTxHash] = useState<string | null>(null);
  const [advancedWithdrawTxHash, setAdvancedWithdrawTxHash] = useState<string | null>(null);
  const [advancedTransferTxHash, setAdvancedTransferTxHash] = useState<string | null>(null);
  const [advancedRemintTxHash, setAdvancedRemintTxHash] = useState<string | null>(null);

  // Deposit Directly Burn related states
  const [directBurn, setDirectBurn] = useState(false);

  // Selected tokenId from deposit forms (for approval check)
  const [simpleDepositTokenId, setSimpleDepositTokenId] = useState<number | null>(null);
  const [advancedDepositTokenId, setAdvancedDepositTokenId] = useState<number | null>(null);
  // Is the selected NFT token approved for ZWERC721? (null = unknown or no token selected)
  const [simpleNftApproved, setSimpleNftApproved] = useState<boolean | null>(null);
  const [advancedNftApproved, setAdvancedNftApproved] = useState<boolean | null>(null);

  // Last Burn information cache - Initialize from localStorage
  const getLastBurnInfoFromStorage = () => {
    try {
      const stored = localStorage.getItem(LAST_BURN_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to read last burn info from localStorage:', error);
    }
    return { tokenId: null, address: null, txHash: null, mode: null };
  };

  const lastBurnInfo = getLastBurnInfoFromStorage();
  const [lastBurnTokenId, setLastBurnTokenId] = useState<number | null>(lastBurnInfo.tokenId);
  const [lastBurnAddress, setLastBurnAddress] = useState<string | null>(lastBurnInfo.address);
  const [lastBurnTxHash, setLastBurnTxHash] = useState<string | null>(lastBurnInfo.txHash);
  const [lastBurnMode, setLastBurnMode] = useState<'simple' | 'advanced' | null>(lastBurnInfo.mode);

  // Simple Mode Deposit (Burn) states
  const [depositSecretModalVisible, setDepositSecretModalVisible] = useState(false);
  const [depositSecretForm] = Form.useForm();
  const [depositSecretList, setDepositSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; claimedTokenIds: number[] }>
  >([]);

  // Advanced Mode Deposit states
  const [advancedDepositSecretModalVisible, setAdvancedDepositSecretModalVisible] = useState(false);
  const [advancedDepositSecretForm] = Form.useForm();
  const [advancedDepositSecretList, setAdvancedDepositSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; claimedTokenIds: number[] }>
  >([]);
  const [advancedDepositSecretMode, setAdvancedDepositSecretMode] = useState<
    'manual' | 'seed' | undefined
  >(undefined);

  // Transfer states
  const [transferSecretMode, setTransferSecretMode] = useState<'manual' | 'seed' | undefined>(
    undefined,
  );
  // Save the burn address generated for transfer, to detect if it's a burn transfer
  const [transferBurnAddress, setTransferBurnAddress] = useState<string | null>(null);

  // Faucet modal state
  const [faucetModalVisible, setFaucetModalVisible] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);

  // ZWERC721 ownership cache: address (lowercase) -> owned tokenIds
  // Uses refs to avoid stale closure issues in async handlers
  const zwNftOwnerCacheRef = React.useRef<Map<string, number[]>>(new Map());
  const nullifierCacheRef = React.useRef<Map<string, boolean>>(new Map());
  const [cacheBuilding, setCacheBuilding] = useState(false);
  const [cacheProgress, setCacheProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [cacheTokenCount, setCacheTokenCount] = useState<number>(0);

  // Get current account
  const account = wallet?.accounts?.[0]?.address;

  // Track current active tab (simple or advanced)
  const [activeMainTab, setActiveMainTab] = useState<string>('simple');
  const [activeSimpleTab, setActiveSimpleTab] = useState<string>('burn');
  const [activeAdvancedTab, setActiveAdvancedTab] = useState<string>('deposit');

  // Helper functions to manage Last Burn info in localStorage
  const saveLastBurnToStorage = (tokenId: number, address: string, txHash: string, mode: 'simple' | 'advanced') => {
    try {
      const burnInfo = {
        tokenId,
        address,
        txHash,
        mode,
      };
      localStorage.setItem(LAST_BURN_STORAGE_KEY, JSON.stringify(burnInfo));
    } catch (error) {
      console.error('Failed to save last burn info to localStorage:', error);
    }
  };

  const clearLastBurnInfo = () => {
    try {
      localStorage.removeItem(LAST_BURN_STORAGE_KEY);
      setLastBurnTokenId(null);
      setLastBurnAddress(null);
      setLastBurnTxHash(null);
      setLastBurnMode(null);
      message.success(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.cleared' }));
    } catch (error) {
      console.error('Failed to clear last burn info:', error);
      message.error(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.clearFailed' }));
    }
  };

  // Listen to window size changes
  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 576);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Refresh underlying NFT balances by scanning token ownership.
  // ZWERC721 balance is maintained by buildZwNftCache (called on mount and after transactions).
  const refreshBalances = React.useCallback(async () => {
    if (!wallet || !account) {
      setNftBalance(0);
      setZwNftBalance(0);
      setUserTokenIds([]);
      setZwUserTokenIds([]);
      return;
    }

    if (!CONTRACT_ADDRESSES.ZWERC721 || !CONTRACT_ADDRESSES.UnderlyingNFT) {
      console.log('ZWERC721 contracts not configured yet');
      setNftBalance(0);
      setZwNftBalance(0);
      setUserTokenIds([]);
      setZwUserTokenIds([]);
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
        console.log('Network is not Sepolia, skipping balance refresh');
        setNftBalance(0);
        setZwNftBalance(0);
        setUserTokenIds([]);
        setZwUserTokenIds([]);
        return;
      }

      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721Faucet,
        provider,
      );

      let maxTokenId;
      try {
        maxTokenId = await nftContract.tokenIdCounter();
      } catch (e) {
        try {
          maxTokenId = await nftContract.getCurrentTokenId();
        } catch (e2) {
          maxTokenId = 100n;
        }
      }

      const userTokens: number[] = [];
      for (let i = 0; i < Number(maxTokenId); i++) {
        try {
          const owner = await nftContract.ownerOf(i);
          if (owner.toLowerCase() === account.toLowerCase()) {
            userTokens.push(i);
          }
        } catch {
          // Token doesn't exist
        }
      }

      setNftBalance(userTokens.length);
      setUserTokenIds(userTokens);

      // ZWERC721 balance is read from the ownership cache (built by buildZwNftCache)
      const cachedZwTokens = zwNftOwnerCacheRef.current.get(account.toLowerCase()) || [];
      setZwNftBalance(cachedZwTokens.length);
      setZwUserTokenIds([...cachedZwTokens]);

      console.log('User NFTs:', userTokens);
      console.log('User ZWERC721 (from cache):', cachedZwTokens);
    } catch (error) {
      console.error('Failed to fetch balances:', error);
    }
  }, [wallet, account]);

  // Build ZWERC721 ownership cache by scanning all tokenIds once.
  // Called on mount and after any transaction that changes ZWERC721 ownership.
  // Also invalidates the nullifier cache since on-chain state has changed.
  const buildZwNftCache = React.useCallback(async () => {
    if (!wallet || !account) return;
    if (!CONTRACT_ADDRESSES.ZWERC721 || !CONTRACT_ADDRESSES.UnderlyingNFT) return;

    try {
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) return;

      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721Faucet,
        provider,
      );
      const zwNftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        provider,
      );

      let maxTokenId: number;
      try {
        maxTokenId = Number(await nftContract.tokenIdCounter());
      } catch {
        try {
          maxTokenId = Number(await nftContract.getCurrentTokenId());
        } catch {
          maxTokenId = 100;
        }
      }

      setCacheBuilding(true);
      setCacheProgress({ current: 0, total: maxTokenId });
      setCacheTokenCount(maxTokenId);

      // Invalidate nullifier cache since on-chain state may have changed
      nullifierCacheRef.current = new Map();

      const newCache = new Map<string, number[]>();
      for (let i = 0; i < maxTokenId; i++) {
        try {
          const owner = await zwNftContract.ownerOf(i);
          const ownerLower = owner.toLowerCase();
          if (!newCache.has(ownerLower)) {
            newCache.set(ownerLower, []);
          }
          newCache.get(ownerLower)!.push(i);
        } catch {
          // Token not minted in ZWERC721
        }
        setCacheProgress({ current: i + 1, total: maxTokenId });
      }

      zwNftOwnerCacheRef.current = newCache;

      // Update ZWERC721 balance display from freshly built cache
      const userZwTokens = newCache.get(account.toLowerCase()) || [];
      setZwNftBalance(userZwTokens.length);
      setZwUserTokenIds([...userZwTokens]);

      console.log(`ZW NFT cache built: ${newCache.size} owners, ${maxTokenId} tokens scanned`);
    } catch (error) {
      console.error('Failed to build ZW NFT cache:', error);
    } finally {
      setCacheBuilding(false);
    }
  }, [wallet, account]);

  // Fetch NFT approval status for Simple Mode (Burn) selected tokenId
  React.useEffect(() => {
    if (!account || !wallet || !CONTRACT_ADDRESSES.ZWERC721 || !CONTRACT_ADDRESSES.UnderlyingNFT) {
      setSimpleNftApproved(null);
      return;
    }
    if (simpleDepositTokenId === null || simpleDepositTokenId === undefined) {
      setSimpleNftApproved(null);
      return;
    }
    const tid = Number(simpleDepositTokenId);
    if (Number.isNaN(tid)) {
      setSimpleNftApproved(null);
      return;
    }
    let cancelled = false;
    const fetchApproval = async () => {
      try {
        const provider = new ethers.BrowserProvider(wallet.provider);
        const nftContract = new ethers.Contract(
          CONTRACT_ADDRESSES.UnderlyingNFT,
          CONTRACT_ABIS.ERC721Faucet,
          provider,
        );
        const approvedAddress = await nftContract.getApproved(tid);
        if (!cancelled) {
          setSimpleNftApproved(approvedAddress.toLowerCase() === CONTRACT_ADDRESSES.ZWERC721.toLowerCase());
        }
      } catch {
        if (!cancelled) setSimpleNftApproved(false);
      }
    };
    fetchApproval();
    return () => { cancelled = true; };
  }, [account, wallet, simpleDepositTokenId]);

  // Fetch NFT approval status for Advanced Mode (Wrap) selected tokenId
  React.useEffect(() => {
    if (!account || !wallet || !CONTRACT_ADDRESSES.ZWERC721 || !CONTRACT_ADDRESSES.UnderlyingNFT) {
      setAdvancedNftApproved(null);
      return;
    }
    if (advancedDepositTokenId === null || advancedDepositTokenId === undefined) {
      setAdvancedNftApproved(null);
      return;
    }
    const tid = Number(advancedDepositTokenId);
    if (Number.isNaN(tid)) {
      setAdvancedNftApproved(null);
      return;
    }
    let cancelled = false;
    const fetchApproval = async () => {
      try {
        const provider = new ethers.BrowserProvider(wallet.provider);
        const nftContract = new ethers.Contract(
          CONTRACT_ADDRESSES.UnderlyingNFT,
          CONTRACT_ABIS.ERC721Faucet,
          provider,
        );
        const approvedAddress = await nftContract.getApproved(tid);
        if (!cancelled) {
          setAdvancedNftApproved(approvedAddress.toLowerCase() === CONTRACT_ADDRESSES.ZWERC721.toLowerCase());
        }
      } catch {
        if (!cancelled) setAdvancedNftApproved(false);
      }
    };
    fetchApproval();
    return () => { cancelled = true; };
  }, [account, wallet, advancedDepositTokenId]);

  // Check if approval is needed - Simple Mode (Burn)
  const simpleNeedsApproval = React.useMemo(() => {
    if (simpleDepositTokenId === null || simpleDepositTokenId === undefined) return false;
    return simpleNftApproved === false;
  }, [simpleDepositTokenId, simpleNftApproved]);

  // Check if approval is needed - Advanced Mode (Wrap)
  const advancedNeedsApproval = React.useMemo(() => {
    if (advancedDepositTokenId === null || advancedDepositTokenId === undefined) return false;
    return advancedNftApproved === false;
  }, [advancedDepositTokenId, advancedNftApproved]);

  // Check and switch to Sepolia network
  React.useEffect(() => {
    const checkNetwork = async () => {
      if (!wallet) return;

      try {
        // Don't pass chainId, get the actually connected network
        const provider = new ethers.BrowserProvider(wallet.provider);
        const network = await provider.getNetwork();

        console.log('Currently connected network chainId:', Number(network.chainId));

        if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
          message.error(
            `Error: Currently connected to Chain ID ${Number(
              network.chainId,
            )} network, please switch to Sepolia testnet (Chain ID: 11155111)`,
            10,
          );

          // Try to switch network
          try {
            await wallet.provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }],
            });
            message.success(intl.formatMessage({ id: 'pages.zwerc721.network.switchSuccess' }));
          } catch (switchError: any) {
            console.error('Failed to switch network:', switchError);
            // If network doesn't exist, try to add network
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
                message.success(intl.formatMessage({ id: 'pages.zwerc721.network.addSuccess' }));
              } catch (addError) {
                console.error('Failed to add network:', addError);
                message.error(intl.formatMessage({ id: 'pages.zwerc721.network.addFailed' }));
              }
            } else {
              message.error(intl.formatMessage({ id: 'pages.zwerc721.network.switchFailed' }));
            }
          }
        } else {
          console.log('✅ Connected to Sepolia testnet');
        }
      } catch (error) {
        console.error('Failed to check network:', error);
      }
    };

    checkNetwork();

    // Listen to network change events
    if (wallet?.provider) {
      const handleChainChanged = (chainId: string) => {
        const decimalChainId = parseInt(chainId, 16);
        console.log('Network switched to chainId:', decimalChainId);

        if (decimalChainId !== SEPOLIA_CHAIN_ID) {
          message.warning(
            `Network has switched to Chain ID ${decimalChainId}, please switch back to Sepolia testnet (Chain ID: 11155111)`,
          );
          // Clear balance display
          setNftBalance(0);
          setZwNftBalance(0);
          setUserTokenIds([]);
          setZwUserTokenIds([]);
        } else {
          message.success(intl.formatMessage({ id: 'pages.zwerc721.network.refreshing' }));
          // Refresh data instead of refreshing page
          setTimeout(() => {
            refreshBalances();
          }, 500);
        }
      };

      wallet.provider.on('chainChanged', handleChainChanged);

      // Cleanup function
      return () => {
        if (wallet?.provider?.removeListener) {
          wallet.provider.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
  }, [wallet, refreshBalances]);

  // Refresh underlying NFT balances on a 10-second timer.
  // ZWERC721 cache is built once on mount and after transactions (not on every tick).
  React.useEffect(() => {
    refreshBalances();
    buildZwNftCache();

    const interval = setInterval(refreshBalances, 10000);
    return () => clearInterval(interval);
  }, [refreshBalances, buildZwNftCache]);

  // Delay preloading circuits files to avoid blocking main page elements loading
  React.useEffect(() => {
    const preloadCircuits = () => {
      try {
        console.log('Starting to preload circuits files...');

        // Use prefetch to preload circuits files
        const link1 = document.createElement('link');
        link1.rel = 'prefetch';
        link1.as = 'fetch';
        link1.href = '/circuits/remint.wasm';
        document.head.appendChild(link1);

        const link2 = document.createElement('link');
        link2.rel = 'prefetch';
        link2.as = 'fetch';
        link2.href = '/circuits/remint_final.zkey';
        document.head.appendChild(link2);

        console.log('Circuits files preload links added');
      } catch (error) {
        console.error('Failed to preload circuits:', error);
      }
    };

    // Use requestIdleCallback to load when browser is idle, or delay 3 seconds
    if ('requestIdleCallback' in window) {
      const idleCallbackId = (window as any).requestIdleCallback(
        preloadCircuits,
        { timeout: 3000 }, // Force execution after at most 3 seconds
      );

      return () => {
        if ('cancelIdleCallback' in window) {
          (window as any).cancelIdleCallback(idleCallbackId);
        }
      };
    } else {
      // Fallback: delay 3 seconds then load
      const timeoutId = setTimeout(preloadCircuits, 3000);
      return () => clearTimeout(timeoutId);
    }
  }, []); // Empty dependency array, only execute once when component mounts

  // When wallet address changes, update Remint forms' recipient field
  React.useEffect(() => {
    if (account) {
      const currentRecipient = remintForm.getFieldValue('recipient');
      if (!currentRecipient) {
        remintForm.setFieldsValue({ recipient: account });
      }
      const currentAdvancedRecipient = advancedRemintForm.getFieldValue('recipient');
      if (!currentAdvancedRecipient) {
        advancedRemintForm.setFieldsValue({ recipient: account });
      }
    }
  }, [account, remintForm, advancedRemintForm]);

  // Get provider and signer, and check network
  const getProvider = async () => {
    if (!wallet) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return null;
    }

    const provider = new ethers.BrowserProvider(wallet.provider);
    const network = await provider.getNetwork();

    if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
      message.error(
        `Currently connected to Chain ID ${Number(
          network.chainId,
        )} network, please switch to Sepolia testnet (Chain ID: 11155111)`,
        5,
      );
      return null;
    }

    return provider;
  };

  // Copy text to clipboard with fallback
  const copyToClipboard = async (text: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        // Fallback for older browsers or non-secure contexts
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
      }
    } catch (err) {
      console.error('Failed to copy:', err);
      return false;
    }
  };

  // Generate Burn Address from Secret
  const generatePrivacyAddress = async (secret: string, tokenId: number) => {
    try {
      const poseidon = await buildPoseidon();
      const secretBigInt = BigInt(secret);
      const id = BigInt(tokenId);

      // Reference logic from e2e.test.js and zkProof.ts
      // For ERC721: addrScalar = Poseidon(8065, tokenId, secret)
      const addrScalar = poseidon.F.toString(poseidon([8065n, id, secretBigInt]));
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
    setTransferBurnAddress(null);
    setTransferSecretMode(undefined);
  };

  // Handle Deposit Directly Burn button click (Simple Mode)
  const handleDepositBurnClick = () => {
    setDepositSecretModalVisible(true);
    // Reset state
    setSeed('');
    setDepositSecretList([]);
    // Auto generate seed
    handleGenerateBySeed('deposit');
  };

  // Handle Advanced Mode Deposit Generate button click
  const handleAdvancedDepositGenerateClick = () => {
    setAdvancedDepositSecretModalVisible(true);
    // Reset state
    setSeed('');
    setAdvancedDepositSecretList([]);
    setAdvancedDepositSecretMode(undefined);
  };

  // Handle Deposit Secret confirmation - Generate Burn Address (Simple Mode)
  const handleDepositSecretConfirm = async () => {
    try {
      const values = await depositSecretForm.validateFields();
      const tokenId = simpleDepositForm.getFieldValue('tokenId');
      
      if (tokenId === undefined || tokenId === null) {
        message.error(intl.formatMessage({ id: 'pages.zwerc721.error.enterTokenId' }));
        return;
      }

      const privacyAddress = await generatePrivacyAddress(values.secret, tokenId);

      // Set to Simple Deposit form targetAddress field
      simpleDepositForm.setFieldsValue({ targetAddress: privacyAddress });

      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.privacyAddressGenerated' }));
      setDepositSecretModalVisible(false);
      depositSecretForm.resetFields();
      setDepositSecretList([]);
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error, do nothing
        return;
      }
      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.message.generateFailed' })}: ${error.message}`);
    }
  };

  // Select Secret for Deposit page (Simple Mode)
  const handleSelectDepositSecret = async (secret: string) => {
    try {
      const tokenId = simpleDepositForm.getFieldValue('tokenId');
      
      if (tokenId === undefined || tokenId === null) {
        message.error(intl.formatMessage({ id: 'pages.zwerc721.error.enterTokenId' }));
        return;
      }

      const privacyAddress = await generatePrivacyAddress(secret, tokenId);
      // Set to Simple Deposit form targetAddress field
      simpleDepositForm.setFieldsValue({ targetAddress: privacyAddress });
      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.privacyAddressGenerated' }));
      setDepositSecretModalVisible(false);
      depositSecretForm.resetFields();
      setDepositSecretList([]);
    } catch (error: any) {
      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.message.generateFailed' })}: ${error.message}`);
    }
  };

  // Select Secret for Advanced Mode Deposit page
  const handleSelectAdvancedDepositSecret = async (secret: string) => {
    try {
      const tokenId = advancedDepositForm.getFieldValue('tokenId');
      
      if (tokenId === undefined || tokenId === null) {
        message.error(intl.formatMessage({ id: 'pages.zwerc721.error.enterTokenId' }));
        return;
      }

      const privacyAddress = await generatePrivacyAddress(secret, tokenId);
      // Set to Advanced Deposit form targetAddress field
      advancedDepositForm.setFieldsValue({ targetAddress: privacyAddress });
      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.privacyAddressGenerated' }));
      setAdvancedDepositSecretModalVisible(false);
      advancedDepositSecretForm.resetFields();
      setAdvancedDepositSecretList([]);
    } catch (error: any) {
      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.message.generateFailed' })}: ${error.message}`);
    }
  };

  // Handle Advanced Deposit Secret confirmation - Generate Burn Address
  const handleAdvancedDepositSecretConfirm = async () => {
    try {
      const values = await advancedDepositSecretForm.validateFields();
      const tokenId = advancedDepositForm.getFieldValue('tokenId');
      
      if (tokenId === undefined || tokenId === null) {
        message.error(intl.formatMessage({ id: 'pages.zwerc721.error.enterTokenId' }));
        return;
      }

      const privacyAddress = await generatePrivacyAddress(values.secret, tokenId);

      // Set to Advanced Deposit form targetAddress field
      advancedDepositForm.setFieldsValue({ targetAddress: privacyAddress });

      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.privacyAddressGenerated' }));
      setAdvancedDepositSecretModalVisible(false);
      advancedDepositSecretForm.resetFields();
      setAdvancedDepositSecretList([]);
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error, do nothing
        return;
      }
      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.message.generateFailed' })}: ${error.message}`);
    }
  };

  // Generate Seed through wallet signature
  const handleGenerateBySeed = async (targetMode?: 'deposit' | 'transfer' | 'advancedDeposit') => {
    if (!wallet || !account) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return;
    }

    // Check if contract addresses are configured
    if (!CONTRACT_ADDRESSES.ZWERC721) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.zwContractNotConfigured' }));
      return;
    }

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();

      // Construct signature message
      const signMessage = `ZWToken: ${CONTRACT_ADDRESSES.ZWERC721}, chainId: ${network.chainId}`;

      // Request signature
      const signature = await signer.signMessage(signMessage);

      // Signature result as Seed
      setSeed(signature);

      // Generate 10 SecretBySeed
      const secrets: Array<{
        index: number;
        secret: string;
        address: string;
        amount: string;
        loading: boolean;
        claimedTokenIds: number[];
      }> = [];
      for (let i = 1; i <= 10; i++) {
        // Seed + index, hash
        const secretBySeed = ethers.keccak256(ethers.toUtf8Bytes(signature + i.toString()));
        // Convert to BigInt format string (remove 0x prefix)
        const secretBigInt = BigInt(secretBySeed).toString();
        secrets.push({
          index: i,
          secret: secretBigInt,
          address: '',
          amount: '-',
          loading: true,
          claimedTokenIds: [],
        });
      }

      // Update the corresponding list based on target mode
      if (targetMode === 'deposit') {
        setDepositSecretList(secrets);
      } else if (targetMode === 'transfer') {
        setSecretList(secrets);
      } else if (targetMode === 'advancedDeposit') {
        setAdvancedDepositSecretList(secrets);
      } else {
        // Fallback: check which modal is open
        if (depositSecretModalVisible) {
          setDepositSecretList(secrets);
        } else if (advancedDepositSecretModalVisible) {
          setAdvancedDepositSecretList(secrets);
        } else {
          setSecretList(secrets);
        }
      }
      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.seedGeneratedQuerying' }));

      // ZWERC721 contract for nullifier checks
      const zwNftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        provider,
      );

      // Use cached token count if available; fall back to fetching from contract
      let currentTokenId: number = cacheTokenCount;
      if (currentTokenId === 0) {
        const nftContract = new ethers.Contract(
          CONTRACT_ADDRESSES.UnderlyingNFT,
          CONTRACT_ABIS.ERC721Faucet,
          provider,
        );
        try {
          currentTokenId = Number(await nftContract.tokenIdCounter());
        } catch {
          try {
            currentTokenId = Number(await nftContract.getCurrentTokenId());
          } catch {
            currentTokenId = 100;
          }
        }
      }
      console.log(`Using cached ownership map (${zwNftOwnerCacheRef.current.size} owners), scanning nullifiers for tokenIds 0-${currentTokenId - 1}`);

      // Helper function to update state based on target mode
      const updateSecretList = (
        updater: (prev: typeof secrets) => typeof secrets
      ) => {
        if (targetMode === 'deposit') {
          setDepositSecretList(updater);
        } else if (targetMode === 'transfer') {
          setSecretList(updater);
        } else if (targetMode === 'advancedDeposit') {
          setAdvancedDepositSecretList(updater);
        } else {
          if (depositSecretModalVisible) {
            setDepositSecretList(updater);
          } else if (advancedDepositSecretModalVisible) {
            setAdvancedDepositSecretList(updater);
          } else {
            setSecretList(updater);
          }
        }
      };

      // For each secret, derive privacy addresses and look up ownership in cache
      for (let i = 0; i < secrets.length; i++) {
        try {
          const secret = secrets[i].secret;
          const ownedTokenIds: number[] = [];
          const claimedTokenIds: number[] = [];

          for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
            try {
              const { privacyAddress, nullifier } = await deriveFromSecret(secret, BigInt(tokenId));
              const privacyAddressLower = privacyAddress.toLowerCase();

              // Check nullifier via cache first, then RPC (nullifiers only go unused -> used)
              const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
              let isNullifierUsed: boolean;
              const cachedNullifier = nullifierCacheRef.current.get(nullifierHex);
              if (cachedNullifier !== undefined) {
                isNullifierUsed = cachedNullifier;
              } else {
                isNullifierUsed = await zwNftContract.nullifierUsed(nullifierHex);
                nullifierCacheRef.current.set(nullifierHex, isNullifierUsed);
              }
              if (isNullifierUsed) {
                claimedTokenIds.push(tokenId);
              }

              // Use ownership cache instead of ownerOf RPC calls
              const ownedByAddress = zwNftOwnerCacheRef.current.get(privacyAddressLower) || [];
              if (ownedByAddress.includes(tokenId)) {
                ownedTokenIds.push(tokenId);
              }
            } catch (deriveError) {
              console.error(`Failed to derive for tokenId ${tokenId}:`, deriveError);
            }
          }

          // Format amount as tokenId list or "0 NFT"
          const amountDisplay = ownedTokenIds.length > 0
            ? `${ownedTokenIds.length} NFT (ID: ${ownedTokenIds.join(', ')})`
            : '0 NFT';

          updateSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, amount: amountDisplay, loading: false, claimedTokenIds }
                : item
            )
          );
        } catch (error) {
          console.error(`Failed to query Secret ${i + 1}:`, error);
          updateSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, amount: intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' }), loading: false, claimedTokenIds: [] }
                : item
            )
          );
        }
      }

      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.queryCompleted' }));
    } catch (error: any) {
      console.error('Failed to generate Seed:', error);
      message.error(`Generate Seed failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Select a SecretBySeed for Transfer page
  const handleSelectSecret = async (secret: string) => {
    try {
      const tokenId = transferForm.getFieldValue('tokenId');
      
      if (tokenId === undefined || tokenId === null) {
        message.error(intl.formatMessage({ id: 'pages.zwerc721.error.enterTokenId' }));
        return;
      }

      const privacyAddress = await generatePrivacyAddress(secret, tokenId);
      // Set to Transfer form targetAddress field
      transferForm.setFieldsValue({ targetAddress: privacyAddress });
      // Save the generated burn address for later detection
      setTransferBurnAddress(privacyAddress);
      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.privacyAddressGenerated' }));
      setSecretModalVisible(false);
      secretForm.resetFields();
      setSecretList([]);
    } catch (error: any) {
      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.message.generateFailed' })}: ${error.message}`);
    }
  };

  // Click button to open modal and generate Seed immediately
  const handleRemintGenerateBySeedClick = async () => {
    if (!wallet || !account) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return;
    }

    // Check if contract addresses are configured
    if (!CONTRACT_ADDRESSES.ZWERC721) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.zwContractNotConfigured' }));
      return;
    }

    // Open modal first
    setRemintSeedModalVisible(true);
    setRemintSecretList([]);

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();

      // Construct signature message
      const signMessage = `ZWToken: ${CONTRACT_ADDRESSES.ZWERC721}, chainId: ${network.chainId}`;

      // Request signature
      const signature = await signer.signMessage(signMessage);

      // Generate 10 SecretBySeed
      const secrets: Array<{
        index: number;
        secret: string;
        address: string;
        amount: string;
        loading: boolean;
        claimedTokenIds: number[];
      }> = [];
      for (let i = 1; i <= 10; i++) {
        // Seed + index, hash
        const secretBySeed = ethers.keccak256(ethers.toUtf8Bytes(signature + i.toString()));
        // Convert to BigInt format string (remove 0x prefix)
        const secretBigInt = BigInt(secretBySeed).toString();
        secrets.push({
          index: i,
          secret: secretBigInt,
          address: '',
          amount: '-',
          loading: true,
          claimedTokenIds: [],
        });
      }

      setRemintSecretList(secrets);
      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.seedGeneratedQuerying' }));

      // ZWERC721 contract for nullifier checks
      const zwNftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        provider,
      );

      // Use cached token count if available
      let currentTokenId: number = cacheTokenCount;
      if (currentTokenId === 0) {
        const nftContract = new ethers.Contract(
          CONTRACT_ADDRESSES.UnderlyingNFT,
          CONTRACT_ABIS.ERC721Faucet,
          provider,
        );
        try {
          currentTokenId = Number(await nftContract.tokenIdCounter());
        } catch {
          try {
            currentTokenId = Number(await nftContract.getCurrentTokenId());
          } catch {
            currentTokenId = 100;
          }
        }
      }

      // For each secret, derive privacy addresses and look up ownership in cache
      for (let i = 0; i < secrets.length; i++) {
        try {
          const secret = secrets[i].secret;
          const ownedTokenIds: number[] = [];
          const claimedTokenIds: number[] = [];

          for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
            try {
              const { privacyAddress, nullifier } = await deriveFromSecret(secret, BigInt(tokenId));
              const privacyAddressLower = privacyAddress.toLowerCase();

              const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
              let isNullifierUsed: boolean;
              const cachedNullifier = nullifierCacheRef.current.get(nullifierHex);
              if (cachedNullifier !== undefined) {
                isNullifierUsed = cachedNullifier;
              } else {
                isNullifierUsed = await zwNftContract.nullifierUsed(nullifierHex);
                nullifierCacheRef.current.set(nullifierHex, isNullifierUsed);
              }
              if (isNullifierUsed) {
                claimedTokenIds.push(tokenId);
              }

              const ownedByAddress = zwNftOwnerCacheRef.current.get(privacyAddressLower) || [];
              if (ownedByAddress.includes(tokenId)) {
                ownedTokenIds.push(tokenId);
              }
            } catch (deriveError) {
              console.error(`Failed to derive for tokenId ${tokenId}:`, deriveError);
            }
          }

          const amountDisplay = ownedTokenIds.length > 0
            ? `${ownedTokenIds.length} NFT (ID: ${ownedTokenIds.join(', ')})`
            : '0 NFT';

          setRemintSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, amount: amountDisplay, loading: false, claimedTokenIds }
                : item
            )
          );
        } catch (error) {
          console.error(`Failed to query Secret ${i + 1}:`, error);
          setRemintSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, amount: intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' }), loading: false, claimedTokenIds: [] }
                : item
            )
          );
        }
      }

      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.queryCompleted' }));
    } catch (error: any) {
      console.error('Failed to generate Seed:', error);
      message.error(`Generate Seed failed: ${error.message}`);
      setRemintSeedModalVisible(false);
    } finally {
      setLoading(false);
    }
  };

  // Select SecretBySeed for Remint page
  const handleSelectRemintSecret = (secret: string, tokenIdFromList?: number) => {
    remintForm.setFieldsValue({ secret });

    // If tokenId is provided, set it
    if (tokenIdFromList !== undefined && tokenIdFromList !== null) {
      remintForm.setFieldsValue({ tokenId: tokenIdFromList });
      setSelectedRemintTokenId(tokenIdFromList);
    }

    setRemintSeedModalVisible(false);
    message.success(intl.formatMessage({ id: 'pages.zwerc721.message.secretSelected' }));
  };

  // Select SecretBySeed for Advanced Remint page
  const handleSelectAdvancedRemintSecret = (secret: string, tokenIdFromList?: number) => {
    advancedRemintForm.setFieldsValue({ secret });

    // If tokenId is provided, set it
    if (tokenIdFromList !== undefined && tokenIdFromList !== null) {
      advancedRemintForm.setFieldsValue({ tokenId: tokenIdFromList });
    }

    setAdvancedRemintSeedModalVisible(false);
    message.success(intl.formatMessage({ id: 'pages.zwerc721.message.secretSelected' }));
  };

  // Advanced Mode Remint - Click button to open modal and generate Seed
  const handleAdvancedRemintGenerateBySeedClick = async () => {
    if (!wallet || !account) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return;
    }

    // Check if contract addresses are configured
    if (!CONTRACT_ADDRESSES.ZWERC721) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.zwContractNotConfigured' }));
      return;
    }

    // Open modal first
    setAdvancedRemintSeedModalVisible(true);
    setAdvancedRemintSecretList([]);

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();

      // Construct signature message
      const signMessage = `ZWToken: ${CONTRACT_ADDRESSES.ZWERC721}, chainId: ${network.chainId}`;

      // Request signature
      const signature = await signer.signMessage(signMessage);

      // Generate 10 SecretBySeed
      const secrets: Array<{
        index: number;
        secret: string;
        address: string;
        amount: string;
        loading: boolean;
        claimedTokenIds: number[];
      }> = [];
      for (let i = 1; i <= 10; i++) {
        // Seed + index, hash
        const secretBySeed = ethers.keccak256(ethers.toUtf8Bytes(signature + i.toString()));
        // Convert to BigInt format string (remove 0x prefix)
        const secretBigInt = BigInt(secretBySeed).toString();
        secrets.push({
          index: i,
          secret: secretBigInt,
          address: '',
          amount: '-',
          loading: true,
          claimedTokenIds: [],
        });
      }

      setAdvancedRemintSecretList(secrets);
      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.seedGeneratedQuerying' }));

      // ZWERC721 contract for nullifier checks
      const zwNftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        provider,
      );

      // Use cached token count if available
      let currentTokenId: number = cacheTokenCount;
      if (currentTokenId === 0) {
        const nftContract = new ethers.Contract(
          CONTRACT_ADDRESSES.UnderlyingNFT,
          CONTRACT_ABIS.ERC721Faucet,
          provider,
        );
        try {
          currentTokenId = Number(await nftContract.tokenIdCounter());
        } catch {
          try {
            currentTokenId = Number(await nftContract.getCurrentTokenId());
          } catch {
            currentTokenId = 100;
          }
        }
      }

      // For each secret, derive privacy addresses and look up ownership in cache
      for (let i = 0; i < secrets.length; i++) {
        try {
          const secret = secrets[i].secret;
          const ownedTokenIds: number[] = [];
          const claimedTokenIds: number[] = [];

          for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
            try {
              const { privacyAddress, nullifier } = await deriveFromSecret(secret, BigInt(tokenId));
              const privacyAddressLower = privacyAddress.toLowerCase();

              const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
              let isNullifierUsed: boolean;
              const cachedNullifier = nullifierCacheRef.current.get(nullifierHex);
              if (cachedNullifier !== undefined) {
                isNullifierUsed = cachedNullifier;
              } else {
                isNullifierUsed = await zwNftContract.nullifierUsed(nullifierHex);
                nullifierCacheRef.current.set(nullifierHex, isNullifierUsed);
              }
              if (isNullifierUsed) {
                claimedTokenIds.push(tokenId);
              }

              const ownedByAddress = zwNftOwnerCacheRef.current.get(privacyAddressLower) || [];
              if (ownedByAddress.includes(tokenId)) {
                ownedTokenIds.push(tokenId);
              }
            } catch (deriveError) {
              console.error(`Failed to derive for tokenId ${tokenId}:`, deriveError);
            }
          }

          const amountDisplay = ownedTokenIds.length > 0
            ? `${ownedTokenIds.length} NFT (ID: ${ownedTokenIds.join(', ')})`
            : '0 NFT';

          setAdvancedRemintSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, amount: amountDisplay, loading: false, claimedTokenIds }
                : item
            )
          );
        } catch (error) {
          console.error(`Failed to query Secret ${i + 1}:`, error);
          setAdvancedRemintSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, amount: intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' }), loading: false, claimedTokenIds: [] }
                : item
            )
          );
        }
      }

      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.queryCompleted' }));
    } catch (error: any) {
      console.error('Failed to generate Seed:', error);
      message.error(`Generate Seed failed: ${error.message}`);
      setAdvancedRemintSeedModalVisible(false);
    } finally {
      setLoading(false);
    }
  };

  // Handle Secret confirmation - Generate Burn Address
  const handleSecretConfirm = async () => {
    try {
      const values = await secretForm.validateFields();
      const tokenId = transferForm.getFieldValue('tokenId');
      
      if (tokenId === undefined || tokenId === null) {
        message.error(intl.formatMessage({ id: 'pages.zwerc721.error.enterTokenId' }));
        return;
      }

      const privacyAddress = await generatePrivacyAddress(values.secret, tokenId);

      // Set to Transfer form targetAddress field
      transferForm.setFieldsValue({ targetAddress: privacyAddress });
      
      // Save the generated burn address for later detection
      setTransferBurnAddress(privacyAddress);

      message.success(intl.formatMessage({ id: 'pages.zwerc721.message.privacyAddressGenerated' }));
      setSecretModalVisible(false);
      secretForm.resetFields();
      setSecretList([]);
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error, do nothing
        return;
      }
      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.message.generateFailed' })}: ${error.message}`);
    }
  };

  // Simple Mode Deposit (Burn) - targetAddress is required
  const handleSimpleDeposit = async (values: { tokenId: number; targetAddress: string }) => {
    console.log('🔵 [Simple Mode] handleSimpleDeposit called with:', values);

    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return;
    }

    // Check if contract addresses are configured
    if (!CONTRACT_ADDRESSES.ZWERC721 || !CONTRACT_ADDRESSES.UnderlyingNFT) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.contractNotConfigured' }));
      return;
    }

    if (!values.targetAddress) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.targetAddressRequired' }));
      return;
    }

    // Check if user owns this NFT
    if (!userTokenIds.includes(values.tokenId)) {
      message.error(`You do not own Token ID ${values.tokenId}`);
      return;
    }

    // 清除之前的交易哈希
    setSimpleBurnTxHash(null);
    setLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721Faucet,
        signer,
      );
      const zwNftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        signer,
      );

      const approvedAddress = await nftContract.getApproved(values.tokenId);
      if (approvedAddress.toLowerCase() !== CONTRACT_ADDRESSES.ZWERC721.toLowerCase()) {
        console.log('[Simple] Starting approval...');
        message.loading(intl.formatMessage({ id: 'pages.zwerc721.burn.approving' }), 0);
        const approveTx = await nftContract.approve(CONTRACT_ADDRESSES.ZWERC721, values.tokenId);
        await approveTx.wait();
        message.destroy();
        message.success(intl.formatMessage({ id: 'pages.zwerc721.burn.approveSuccess' }));
        setSimpleNftApproved(true);
        setLoading(false);
        return;
      }

      console.log('[Simple] Approval sufficient, proceeding to burn...');

      const tx = await zwNftContract.deposit(values.targetAddress, values.tokenId, 1, '0x');

      message.loading(intl.formatMessage({ id: 'pages.zwerc721.burn.submitting' }), 0);
      const receipt = await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwerc721.burn.success' }));
      
      // 保存交易哈希以显示
      setSimpleBurnTxHash(receipt.hash);
      
      // Save Last Burn information (Simple Mode - always burn)
      const burnTokenId = values.tokenId;
      const burnAddress = values.targetAddress;
      const burnTxHash = receipt.hash;
      const burnMode = 'simple';
      
      setLastBurnTokenId(burnTokenId);
      setLastBurnAddress(burnAddress);
      setLastBurnTxHash(burnTxHash);
      setLastBurnMode(burnMode);
      saveLastBurnToStorage(burnTokenId, burnAddress, burnTxHash, burnMode);
      
      simpleDepositForm.resetFields();
      setSimpleDepositTokenId(null);
      refreshBalances();
      buildZwNftCache();
    } catch (error: any) {
      console.error('❌ [Simple] Deposit/Approve error:', error);
      message.destroy();

      let errorMessage = error.message || 'Unknown error';
      if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
        errorMessage = intl.formatMessage({ id: 'pages.zwerc721.error.userRejected' });
      }

      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.burn.failed' })}: ${errorMessage}`);
    } finally {
      console.log('🏁 [Simple] handleSimpleDeposit finished');
      setLoading(false);
    }
  };

  // Advanced Mode Deposit (Wrap) - targetAddress is optional
  const handleAdvancedDeposit = async (values: { tokenId: number; targetAddress?: string }) => {
    console.log('🟢 [Advanced Mode] handleAdvancedDeposit called with:', {
      ...values,
      directBurn,
    });

    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return;
    }

    // Check if contract addresses are configured
    if (!CONTRACT_ADDRESSES.ZWERC721 || !CONTRACT_ADDRESSES.UnderlyingNFT) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.contractNotConfigured' }));
      return;
    }

    // Check if user owns this NFT
    if (!userTokenIds.includes(values.tokenId)) {
      message.error(`You do not own Token ID ${values.tokenId}`);
      return;
    }

    // If directBurn is enabled, targetAddress is required
    if (directBurn && !values.targetAddress) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.targetAddressRequired' }));
      return;
    }

    // 清除之前的交易哈希
    setAdvancedDepositTxHash(null);
    setLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721Faucet,
        signer,
      );
      const zwNftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        signer,
      );

      const approvedAddress = await nftContract.getApproved(values.tokenId);
      if (approvedAddress.toLowerCase() !== CONTRACT_ADDRESSES.ZWERC721.toLowerCase()) {
        console.log('[Advanced] Starting approval...');
        message.loading(intl.formatMessage({ id: 'pages.zwerc721.wrap.approving' }), 0);
        const approveTx = await nftContract.approve(CONTRACT_ADDRESSES.ZWERC721, values.tokenId);
        await approveTx.wait();
        message.destroy();
        message.success(intl.formatMessage({ id: 'pages.zwerc721.wrap.approveSuccess' }));
        setAdvancedNftApproved(true);
        setLoading(false);
        return;
      }

      console.log('[Advanced] Approval sufficient, proceeding to wrap...');

      const toAddress = values.targetAddress || account;
      const tx = await zwNftContract.deposit(toAddress, values.tokenId, 1, '0x');

      message.loading(intl.formatMessage({ id: 'pages.zwerc721.wrap.submitting' }), 0);
      const receipt = await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwerc721.wrap.success' }));
      
      // 保存交易哈希以显示
      setAdvancedDepositTxHash(receipt.hash);
      
      // Save Last Burn information (Advanced Mode with Direct Burn)
      // directBurn checkbox determines if this is a burn operation
      if (directBurn && values.targetAddress) {
        const burnTokenId = values.tokenId;
        const burnAddress = values.targetAddress;
        const burnTxHash = receipt.hash;
        const burnMode = 'advanced';
        
        setLastBurnTokenId(burnTokenId);
        setLastBurnAddress(burnAddress);
        setLastBurnTxHash(burnTxHash);
        setLastBurnMode(burnMode);
        saveLastBurnToStorage(burnTokenId, burnAddress, burnTxHash, burnMode);
      }
      
      advancedDepositForm.resetFields();
      setAdvancedDepositTokenId(null);
      setDirectBurn(false);
      refreshBalances();
      buildZwNftCache();
    } catch (error: any) {
      console.error('❌ [Advanced] Deposit/Approve error:', error);
      message.destroy();

      let errorMessage = error.message || 'Unknown error';
      if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
        errorMessage = intl.formatMessage({ id: 'pages.zwerc721.error.userRejected' });
      }

      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.wrap.failed' })}: ${errorMessage}`);
    } finally {
      console.log('🏁 [Advanced] handleAdvancedDeposit finished');
      setLoading(false);
    }
  };

  // Withdraw operation
  const handleWithdraw = async (values: { tokenId: number }) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return;
    }

    // Check if contract addresses are configured
    if (!CONTRACT_ADDRESSES.ZWERC721) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.contractNotConfigured' }));
      return;
    }

    // Check if user owns this ZWERC721 token
    if (!zwUserTokenIds.includes(values.tokenId)) {
      message.error(`You do not own ZWERC721 Token ID ${values.tokenId}`);
      return;
    }

    // 清除之前的交易哈希
    setAdvancedWithdrawTxHash(null);
    setLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      const zwNftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        signer,
      );

      console.log(`Withdraw tokenId: ${values.tokenId}`);

      const signerAddress = await signer.getAddress();
      const tx = await zwNftContract.withdraw(signerAddress, values.tokenId, 1, '0x');

      message.loading(intl.formatMessage({ id: 'pages.zwerc721.unwrap.submitting' }), 0);
      const receipt = await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwerc721.unwrap.success' }));
      
      // 保存交易哈希以显示
      setAdvancedWithdrawTxHash(receipt.hash);
      
      withdrawForm.resetFields();
      refreshBalances();
      buildZwNftCache();
    } catch (error: any) {
      message.destroy();
      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.unwrap.failed' })}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Transfer operation
  const handleTransfer = async (values: { targetAddress: string; tokenId: number }) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return;
    }

    // Check if contract addresses are configured
    if (!CONTRACT_ADDRESSES.ZWERC721) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.contractNotConfigured' }));
      return;
    }

    // Check if user owns this ZWERC721 token
    if (!zwUserTokenIds.includes(values.tokenId)) {
      message.error(`You do not own ZWERC721 Token ID ${values.tokenId}`);
      return;
    }

    // 清除之前的交易哈希
    setAdvancedTransferTxHash(null);
    setLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      const zwNftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        signer,
      );

      console.log(`Transfer tokenId: ${values.tokenId} to ${values.targetAddress}`);

      const tx = await zwNftContract.transferFrom(account, values.targetAddress, values.tokenId);

      message.loading(intl.formatMessage({ id: 'pages.zwerc721.transfer.submitting' }), 0);
      const receipt = await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwerc721.transfer.success' }));
      
      // 保存交易哈希以显示
      setAdvancedTransferTxHash(receipt.hash);
      
      // Save Last Burn information (Transfer with Burn address)
      // If the target address matches the saved burn address, this is a burn transfer
      if (transferBurnAddress && values.targetAddress.toLowerCase() === transferBurnAddress.toLowerCase()) {
        const burnTokenId = values.tokenId;
        const burnAddress = values.targetAddress;
        const burnTxHash = receipt.hash;
        const burnMode = 'simple';
        
        setLastBurnTokenId(burnTokenId);
        setLastBurnAddress(burnAddress);
        setLastBurnTxHash(burnTxHash);
        setLastBurnMode(burnMode);
        saveLastBurnToStorage(burnTokenId, burnAddress, burnTxHash, burnMode);
      }
      
      transferForm.resetFields();
      setTransferBurnAddress(null);
      refreshBalances();
      buildZwNftCache();
    } catch (error: any) {
      message.destroy();
      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.transfer.failed' })}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Faucet mint operation
  const handleFaucetMint = async () => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return;
    }

    // Check if contract addresses are configured
    if (!CONTRACT_ADDRESSES.ERC721Faucet) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.contractNotConfigured' }));
      return;
    }

    setFaucetLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setFaucetLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721Faucet,
        signer,
      );

      console.log('Calling faucetMint for:', account);

      const tx = await nftContract.faucetMint(account);

      message.loading(intl.formatMessage({ id: 'pages.zwerc721.faucet.minting' }), 0);
      const receipt = await tx.wait();
      message.destroy();

      // Parse the Transfer event to get the tokenId
      const transferEvent = receipt.logs.find((log: any) => {
        try {
          const parsed = nftContract.interface.parseLog(log);
          return parsed?.name === 'Transfer';
        } catch {
          return false;
        }
      });

      let tokenId = 'N/A';
      if (transferEvent) {
        const parsed = nftContract.interface.parseLog(transferEvent);
        tokenId = parsed?.args?.tokenId?.toString() || 'N/A';
      }

      message.success(`${intl.formatMessage({ id: 'pages.zwerc721.faucet.mintSuccess' })} #${tokenId}!`);
      console.log(`✅ Minted NFT #${tokenId}, tx: ${receipt.hash}`);

      setFaucetModalVisible(false);
      refreshBalances();
    } catch (error: any) {
      message.destroy();
      console.error('Faucet mint error:', error);

      let errorMessage = error.message || 'Unknown error';
      if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
        errorMessage = intl.formatMessage({ id: 'pages.zwerc721.error.userRejected' });
      }

      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.faucet.mintFailed' })}: ${errorMessage}`);
    } finally {
      setFaucetLoading(false);
    }
  };

  // Remint operation
  const handleRemint = async (values: any) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
      return;
    }

    // Check if contract addresses are configured
    if (!CONTRACT_ADDRESSES.ZWERC721) {
      message.error(intl.formatMessage({ id: 'pages.zwerc721.error.contractNotConfigured' }));
      return;
    }

    // 清除之前的交易哈希（根据当前模式）
    if (activeMainTab === 'simple') {
      setSimpleRemintTxHash(null);
    } else {
      setAdvancedRemintTxHash(null);
    }
    setLoading(true);
    const hideLoading = message.loading(intl.formatMessage({ id: 'pages.zwerc721.remint.preparingZK' }), 0);

    try {
      const provider = await getProvider();
      if (!provider) {
        hideLoading();
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      const zwNftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        signer,
      );

      const tokenId = values.tokenId;

      // === Step 1: Derive parameters from Secret ===
      console.log('Step 1: Deriving from secret...');
      const { privacyAddress, addr20, q, nullifier, secret } = await deriveFromSecret(
        values.secret,
        tokenId,
      );
      console.log(`Privacy address: ${privacyAddress}`);
      console.log(`Nullifier: 0x${nullifier.toString(16)}`);

      const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
      const isNullifierUsed = await zwNftContract.nullifierUsed(nullifierHex);
      if (isNullifierUsed) {
        hideLoading();
        message.error(intl.formatMessage({ id: 'pages.zwerc721.remint.nullifierUsed' }));
        return;
      }

      try {
        const currentOwner = await zwNftContract.ownerOf(tokenId);
        if (currentOwner.toLowerCase() !== privacyAddress.toLowerCase()) {
          hideLoading();
          message.error(`Privacy address does not own Token ID ${tokenId}`);
          return;
        }
      } catch (error) {
        hideLoading();
        message.error(`Token ID ${tokenId} does not exist or has been burned`);
        return;
      }

      // === Step 2: Rebuild Merkle tree from chain ===
      hideLoading();
      message.loading(intl.formatMessage({ id: 'pages.zwerc721.remint.rebuildingTree' }), 0);
      console.log('Step 2: Rebuilding Merkle tree from chain...');

      const poseidon = await buildPoseidon();
      const tree = await rebuildMerkleTree(zwNftContract, poseidon);

      const onchainRoot = await zwNftContract.root();
      const localRoot = '0x' + tree.root.toString(16).padStart(64, '0');
      console.log(`On-chain root: ${onchainRoot}`);
      console.log(`Local root:    ${localRoot}`);

      if (localRoot !== onchainRoot) {
        message.destroy();
        message.error(intl.formatMessage({ id: 'pages.zwerc721.remint.rootMismatch' }));
        return;
      }

      // === Step 3: Find user's commitment ===
      message.destroy();
      message.loading(intl.formatMessage({ id: 'pages.zwerc721.remint.findingCommitment' }), 0);
      console.log('Step 3: Finding user commitment...');

      const userCommitment = await findUserCommitment(zwNftContract, privacyAddress, poseidon, tokenId);
      if (!userCommitment) {
        message.destroy();
        message.error(intl.formatMessage({ id: 'pages.zwerc721.remint.commitmentNotFound' }));
        return;
      }

      console.log(`Found commitment at index ${userCommitment.index}`);
      console.log(`First receipt tokenId: ${tokenId}`);

      // For NFTs, amount is always 1
      const remintAmount = 1n;

      // === Step 4: Generate Merkle proof ===
      message.destroy();
      message.loading(intl.formatMessage({ id: 'pages.zwerc721.remint.generatingMerkle' }), 0);
      console.log('Step 4: Generating Merkle proof...');

      const merkleProof = tree.getProof(userCommitment.index);
      console.log(`Merkle proof generated (${merkleProof.pathElements.length} elements)`);

      // === Step 5: Prepare circuit input ===
      const redeem = values.redeem || false;
      const relayerFee = 0; // Always 0 for NFTs

      const circuitInput = prepareCircuitInput({
        root: tree.root,
        nullifier,
        recipient: values.recipient,
        remintAmount: remintAmount,
        id: BigInt(tokenId),  // Use actual tokenId for ERC721
        redeem: redeem,
        relayerFee: BigInt(relayerFee),
        secret,
        addr20,
        commitAmount: userCommitment.amount,  // Always 1 for NFTs
        q,
        merkleProof,
      });

      console.log('Circuit input prepared:', circuitInput);

      // === Step 6: Generate ZK proof ===
      message.destroy();
      message.loading(intl.formatMessage({ id: 'pages.zwerc721.remint.generatingZK' }), 0);
      console.log('Step 6: Generating ZK proof (this may take 10-30 seconds)...');

      try {
        // Use circuit to generate real ZK proof (if preloaded, browser will read from cache)
        const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
          circuitInput,
          '/circuits/remint.wasm',
          '/circuits/remint_final.zkey',
        );

        console.log('✅ ZK proof generated!');
        console.log('Public signals:', publicSignals);

        // Format as Solidity calldata
        const calldata = await snarkjs.groth16.exportSolidityCallData(zkProof, publicSignals);
        const calldataJson = JSON.parse('[' + calldata + ']');

        const solidityProof = {
          a: calldataJson[0],
          b: calldataJson[1],
          c: calldataJson[2],
        };

        console.log('✅ Proof formatted for Solidity');

        // Encode proof bytes
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const proofBytes = abiCoder.encode(
          ['uint256[2]', 'uint256[2][2]', 'uint256[2]'],
          [solidityProof.a, solidityProof.b, solidityProof.c],
        );

        // === Step 7: Submit remint transaction ===
        message.destroy();
        message.loading(intl.formatMessage({ id: 'pages.zwerc721.remint.submitting' }), 0);
        console.log('Step 7: Submitting remint transaction...');

        // Encode relayerData (always empty for NFTs)
        const relayerData = '0x';

        const tx = await zwNftContract.remint(
          values.recipient, // to
          tokenId, // id (actual tokenId for NFTs)
          remintAmount, // amount (always 1 for NFTs)
          {
            // RemintData struct (ERC-8065 spec)
            commitment: localRoot,
            nullifiers: [nullifierHex],
            proverData: '0x',
            relayerData: relayerData,
            redeem: redeem, // redeem flag is now inside RemintData
            proof: proofBytes,
          },
        );

        console.log('Transaction submitted, waiting for confirmation...');
        const receipt = await tx.wait();

        message.destroy();
        message.success(intl.formatMessage({ id: 'pages.zwerc721.remint.success' }));
        console.log(`✅ Remint succeeded! Gas used: ${receipt.gasUsed}`);

        // 保存交易哈希以显示（根据当前模式）
        if (activeMainTab === 'simple') {
          setSimpleRemintTxHash(receipt.hash);
        } else {
          setAdvancedRemintTxHash(receipt.hash);
        }

        if (activeMainTab === 'simple') {
          remintForm.resetFields();
        } else {
          advancedRemintForm.resetFields();
        }
        setSelectedRemintTokenId(null);
        refreshBalances();
        buildZwNftCache();
      } catch (proofError: any) {
        message.destroy();
        console.error('ZK proof generation or remint error:', proofError);
        message.error(`${intl.formatMessage({ id: 'pages.zwerc721.remint.failed' })}: ${proofError.message}`);
      }
    } catch (error: any) {
      message.destroy();
      console.error('Remint error:', error);
      message.error(`${intl.formatMessage({ id: 'pages.zwerc721.remint.failed' })}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating cache progress indicator (top-right corner) */}
      {cacheBuilding && (
        <div
          style={{
            position: 'fixed',
            top: 72,
            right: 20,
            zIndex: 9999,
            padding: '12px 16px',
            background: 'rgba(20, 20, 30, 0.88)',
            backdropFilter: 'blur(6px)',
            borderRadius: 10,
            color: '#fff',
            fontSize: 13,
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            minWidth: 220,
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 15 }}>🔄</span>
            <span style={{ fontWeight: 600 }}>{intl.formatMessage({ id: 'pages.zwerc721.cache.building' })}</span>
          </div>
          <div
            style={{
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 4,
              height: 6,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: 'linear-gradient(90deg, #1890ff, #52c41a)',
                height: '100%',
                width: `${cacheProgress.total > 0 ? Math.round((cacheProgress.current / cacheProgress.total) * 100) : 0}%`,
                transition: 'width 0.15s ease',
              }}
            />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7, textAlign: 'right' }}>
            {cacheProgress.current} / {cacheProgress.total} tokens
          </div>
        </div>
      )}

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
            <span>ZWERC721 - Zero Knowledge Wrapper NFT</span>
            <a
              href="https://eips.ethereum.org/EIPS/eip-8065"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#1890ff',
                fontSize: '18px',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
We propose <span style={{ textDecoration: 'underline' }}>ERC-8065</span>: Zero Knowledge Token Wrapper to achieve our goal.
            </a>
          </div>
        ),
      }}
    >
      {/* Balance display card */}
      <div
        style={{
          marginBottom: 24,
          padding: '20px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: 8,
          cursor: account ? 'default' : 'pointer',
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onClick={() => {
          if (!account) {
            connect();
          }
        }}
        onMouseEnter={(e) => {
          if (!account) {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 8px 16px rgba(102, 126, 234, 0.3)';
          }
        }}
        onMouseLeave={(e) => {
          if (!account) {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }
        }}
      >
          {/* Faucet tip */}
          <div
            style={{
              marginBottom: 16,
              paddingBottom: 16,
              borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: '#fff', fontSize: 14 }}>
              {intl.formatMessage({ id: 'pages.zwerc721.faucet.tip' })}
            </span>
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                if (!account) {
                  message.warning(intl.formatMessage({ id: 'pages.zwerc721.error.connectWallet' }));
                  connect();
                } else {
                  setFaucetModalVisible(true);
                }
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                color: '#fff',
                fontWeight: 'bold',
              }}
            >
              {intl.formatMessage({ id: 'pages.zwerc721.faucet.button' })}
            </Button>
          </div>

          {/* Balance information */}
          <div
            style={{
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
                {intl.formatMessage({ id: 'pages.zwerc721.balance.nft' })}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: '#fff',
                  wordBreak: 'break-all',
                }}
              >
                {account ? (
                  <>
                    {nftBalance}{' '}
                    {CONTRACT_ADDRESSES.UnderlyingNFT ? (
                      <a
                        href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.UnderlyingNFT}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: '#fff',
                          textDecoration: 'underline',
                          textDecorationColor: 'rgba(255, 255, 255, 0.6)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        NFT
                      </a>
                    ) : (
                      <span>NFT</span>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 16, opacity: 0.9 }}>{intl.formatMessage({ id: 'pages.zwerc721.balance.connectWallet' })}</span>
                )}
              </div>
              {account && userTokenIds.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {userTokenIds.map((tokenId) => (
                    <Tag key={tokenId} color="blue" style={{ marginBottom: 4 }}>
                      #{tokenId}
                    </Tag>
                  ))}
                </div>
              )}
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
                {intl.formatMessage({ id: 'pages.zwerc721.balance.zwnft' })}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: '#fff',
                  wordBreak: 'break-all',
                }}
              >
                {account ? (
                  <>
                    {zwNftBalance}{' '}
                    {CONTRACT_ADDRESSES.ZWERC721 ? (
                      <a
                        href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.ZWERC721}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: '#fff',
                          textDecoration: 'underline',
                          textDecorationColor: 'rgba(255, 255, 255, 0.6)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        ZWNFT
                      </a>
                    ) : (
                      <span>ZWNFT</span>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 16, opacity: 0.9 }}>{intl.formatMessage({ id: 'pages.zwerc721.balance.connectWallet' })}</span>
                )}
              </div>
              {account && zwUserTokenIds.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {zwUserTokenIds.map((tokenId) => (
                    <Tag key={tokenId} color="purple" style={{ marginBottom: 4 }}>
                      #{tokenId}
                    </Tag>
                  ))}
                </div>
              )}
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

            <div
              style={{
                flex: '1 1 200px',
                minWidth: '200px',
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  color: 'rgba(255, 255, 255, 0.8)',
                  marginBottom: 8,
                }}
              >
                {intl.formatMessage({ id: 'pages.zwerc721.balance.remintable' })}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: '#fff',
                  wordBreak: 'break-all',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: account ? 'pointer' : 'default',
                }}
                onClick={(e) => {
                  if (account) {
                    e.stopPropagation();
                    // Switch to remint tab based on current mode
                    if (activeMainTab === 'simple') {
                      setActiveSimpleTab('remint');
                      // Trigger the Select button action after tab switch
                      setTimeout(() => {
                        handleRemintGenerateBySeedClick();
                      }, 100);
                    } else {
                      setActiveAdvancedTab('remint');
                      // Trigger the Select button action for Advanced mode after tab switch
                      setTimeout(() => {
                        handleAdvancedRemintGenerateBySeedClick();
                      }, 100);
                    }
                    // Scroll to the card
                    setTimeout(() => {
                      const card = document.querySelector('.ant-card');
                      if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }, 100);
                  }
                }}
              >
                {account ? (
                  <>
                    <span>****</span>
                    <Button
                      type="primary"
                      size="small"
                      style={{
                        background: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: '#fff',
                      }}
                    >
                      {intl.formatMessage({ id: 'pages.zwerc721.balance.scan' })}
                    </Button>
                  </>
                ) : (
                  <span style={{ fontSize: 16, opacity: 0.9 }}>{intl.formatMessage({ id: 'pages.zwerc721.balance.connectWallet' })}</span>
                )}
              </div>
            </div>
          </div>
        </div>

      {/* Last Burn Information card */}
      {lastBurnTokenId !== null && lastBurnAddress && (
        <div
          style={{
            marginBottom: 24,
            padding: '20px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: 8,
            position: 'relative',
          }}
        >
          {/* Close button */}
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={clearLastBurnInfo}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              color: '#fff',
              padding: 4,
              height: 'auto',
              minWidth: 'auto',
            }}
            title={intl.formatMessage({ id: 'pages.zwerc721.lastBurn.clearTitle' })}
          />
          <div style={{ color: '#fff' }}>
            <h3 style={{ color: '#fff', marginBottom: 16, fontSize: 18, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8 }}>
              {intl.formatMessage({ id: 'pages.zwerc721.lastBurn.title' })}
              <Tooltip title={intl.formatMessage({ id: 'pages.zwerc721.lastBurn.tooltip' })}>
                <InfoCircleOutlined style={{ fontSize: 16, cursor: 'pointer', opacity: 0.7 }} />
              </Tooltip>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Token ID */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, opacity: 0.9, minWidth: 80 }}>{intl.formatMessage({ id: 'pages.zwerc721.lastBurn.tokenId' })}</span>
                <span style={{ fontSize: 16, fontWeight: 'bold' }}>
                  #{lastBurnTokenId}
                </span>
              </div>

              {/* Address */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, opacity: 0.9, minWidth: 80 }}>{intl.formatMessage({ id: 'pages.zwerc721.lastBurn.address' })}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <span
                    style={{
                      fontSize: isMobile ? 12 : 14,
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      flex: 1,
                    }}
                  >
                    {lastBurnAddress}
                  </span>
                  <Button
                    type="link"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      const success = await copyToClipboard(lastBurnAddress);
                      if (success) {
                        message.success(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.addressCopied' }));
                      } else {
                        message.error(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.copyFailed' }));
                      }
                    }}
                    style={{ color: '#fff', padding: 0, height: 'auto' }}
                  />
                </div>
              </div>

              {/* Transaction Hash */}
              {lastBurnTxHash && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, opacity: 0.9, minWidth: 80 }}>{intl.formatMessage({ id: 'pages.zwerc721.lastBurn.txHash' })}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${lastBurnTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: isMobile ? 12 : 14,
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        flex: 1,
                        color: '#fff',
                        textDecoration: 'underline',
                      }}
                    >
                      {lastBurnTxHash}
                    </a>
                    <Button
                      type="link"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={async () => {
                        const success = await copyToClipboard(lastBurnTxHash);
                        if (success) {
                          message.success(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.txHashCopied' }));
                        } else {
                          message.error(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.copyFailed' }));
                        }
                      }}
                      style={{ color: '#fff', padding: 0, height: 'auto' }}
                    />
                  </div>
                </div>
              )}

              {/* Tip with Remint button */}
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: 'rgba(255, 255, 255, 0.15)',
                  borderRadius: 4,
                  fontSize: 12,
                  opacity: 0.95,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span>{intl.formatMessage({ id: 'pages.zwerc721.lastBurn.tip' })}</span>
                <Button
                  type="primary"
                  size="small"
                  onClick={() => {
                    // Switch to remint tab based on current mode
                    if (activeMainTab === 'simple') {
                      setActiveSimpleTab('remint');
                    } else {
                      setActiveAdvancedTab('remint');
                    }
                    // Scroll to the card
                    setTimeout(() => {
                      const card = document.querySelector('.ant-card');
                      if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }, 100);
                  }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: 'none',
                    color: '#fff',
                  }}
                >
                  {intl.formatMessage({ id: 'pages.zwerc721.lastBurn.goToRemint' })}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Card>
        {/* Outer main Tab: Simple Mode and Advanced Mode */}
        <Tabs 
          defaultActiveKey="simple" 
          type="card" 
          size="large"
          onChange={(key) => setActiveMainTab(key)}
        >
          {/* Simple Mode - Only includes Burn and Remint */}
          <TabPane tab={intl.formatMessage({ id: 'pages.zwerc721.tab.simpleMode' })} key="simple">
            <Tabs 
              activeKey={activeSimpleTab}
              onChange={(key) => setActiveSimpleTab(key)}
              type="line" 
              style={{ marginTop: 16 }}
            >
              <TabPane tab={intl.formatMessage({ id: 'pages.zwerc721.tab.burn' })} key="burn">
                <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                  {!CONTRACT_ADDRESSES.ZWERC721 || !CONTRACT_ADDRESSES.UnderlyingNFT ? (
                    <Empty description={intl.formatMessage({ id: 'pages.zwerc721.error.contractNotDeployed' })} />
                  ) : (
                    <Form form={simpleDepositForm} layout="vertical" onFinish={handleSimpleDeposit}>
                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.burn.tokenId.label' })}
                        name="tokenId"
                        rules={[
                          {
                            required: true,
                            message: intl.formatMessage({ id: 'pages.zwerc721.burn.tokenId.required' }),
                          },
                          {
                            type: 'number',
                            min: 0,
                            message: intl.formatMessage({ id: 'pages.zwerc721.burn.tokenId.min' }),
                          },
                        ]}
                      >
                        <InputNumber
                          style={{ width: '100%' }}
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.burn.tokenId.placeholder' })}
                          precision={0}
                          min={0}
                          onChange={(value) => {
                            setSimpleDepositTokenId(value ?? null);
                            simpleDepositForm.setFieldsValue({ targetAddress: undefined });
                          }}
                        />
                      </Form.Item>

                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.burn.privacyAddress.label' })}
                        name="targetAddress"
                        rules={[
                          {
                            required: true,
                            message: intl.formatMessage({ id: 'pages.zwerc721.burn.privacyAddress.required' }),
                          },
                          {
                            pattern: /^0x[a-fA-F0-9]{40}$/,
                            message: intl.formatMessage({ id: 'pages.zwerc721.burn.privacyAddress.invalid' }),
                          },
                        ]}
                      >
                        <Input
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.burn.privacyAddress.placeholder' })}
                          maxLength={42}
                          addonBefore={
                            <Button
                              type="link"
                              onClick={handleDepositBurnClick}
                              style={{ padding: 0, height: 'auto', whiteSpace: 'nowrap' }}
                            >
                              {intl.formatMessage({ id: 'pages.zwerc721.burn.generate' })}
                            </Button>
                          }
                        />
                      </Form.Item>

                      <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} block>
                          {simpleNeedsApproval
                            ? 'Approve'
                            : intl.formatMessage({ id: 'pages.zwerc721.burn.button' })}
                        </Button>
                      </Form.Item>

                      {/* 显示交易哈希 */}
                      {simpleBurnTxHash && (
                        <div style={{ marginTop: 12, textAlign: 'center' }}>
                          <span style={{ color: '#52c41a', fontSize: '14px' }}>
                            {intl.formatMessage({ id: 'pages.zwerc721.burn.txSubmitted' })}{' '}
                            <a
                              href={`https://sepolia.etherscan.io/tx/${simpleBurnTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1890ff', textDecoration: 'underline' }}
                            >
                              {simpleBurnTxHash.substring(0, 10)}...{simpleBurnTxHash.substring(simpleBurnTxHash.length - 8)}
                            </a>
                          </span>
                        </div>
                      )}
                    </Form>
                  )}

                  <div
                    style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}
                  >
                    <h4>{intl.formatMessage({ id: 'pages.zwerc721.burn.tip.title' })}</h4>
                    <p>
                      <strong>{intl.formatMessage({ id: 'pages.zwerc721.burn.tip.what' })}</strong>
                    </p>
                    <p>{intl.formatMessage({ id: 'pages.zwerc721.burn.tip.whatDesc' })}</p>
                    <p>
                      <strong>{intl.formatMessage({ id: 'pages.zwerc721.burn.tip.how' })}</strong>
                    </p>
                    <p>{intl.formatMessage({ id: 'pages.zwerc721.burn.tip.step1' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwerc721.burn.tip.step2' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwerc721.burn.tip.step3' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwerc721.burn.tip.step4' })}</p>
                  </div>
                </div>
              </TabPane>

              <TabPane tab={intl.formatMessage({ id: 'pages.zwerc721.tab.remint' })} key="remint">
                <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                  {!CONTRACT_ADDRESSES.ZWERC721 ? (
                    <Empty description={intl.formatMessage({ id: 'pages.zwerc721.error.contractNotDeployed' })} />
                  ) : (
                    <Form
                      form={remintForm}
                      layout="vertical"
                      onFinish={handleRemint}
                      initialValues={{
                        recipient: account || undefined,
                        redeem: true,
                      }}
                    >
                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.remint.tokenId.label' })}
                        name="tokenId"
                        rules={[
                          {
                            required: true,
                            message: intl.formatMessage({ id: 'pages.zwerc721.remint.tokenId.required' }),
                          },
                          {
                            type: 'number',
                            min: 0,
                            message: intl.formatMessage({ id: 'pages.zwerc721.remint.tokenId.min' }),
                          },
                        ]}
                      >
                        <InputNumber
                          style={{ width: '100%' }}
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.remint.tokenId.placeholder' })}
                          precision={0}
                          min={0}
                        />
                      </Form.Item>

                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.remint.secret.label' })}
                        name="secret"
                        rules={[
                          {
                            required: true,
                            message: intl.formatMessage({ id: 'pages.zwerc721.remint.secret.required' }),
                          },
                        ]}
                      >
                        <Input.Password
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.remint.secret.placeholder' })}
                          addonBefore={
                            <Button
                              type="link"
                              onClick={handleRemintGenerateBySeedClick}
                              style={{ padding: 0, height: 'auto', whiteSpace: 'nowrap' }}
                            >
                              {isMobile ? intl.formatMessage({ id: 'pages.zwerc721.remint.selectMobile' }) : intl.formatMessage({ id: 'pages.zwerc721.remint.selectBySeed' })}
                            </Button>
                          }
                        />
                      </Form.Item>

                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.remint.recipient.label' })}
                        name="recipient"
                        rules={[
                          {
                            required: true,
                            message: intl.formatMessage({ id: 'pages.zwerc721.remint.recipient.required' }),
                          },
                          {
                            pattern: /^0x[a-fA-F0-9]{40}$/,
                            message: intl.formatMessage({ id: 'pages.zwerc721.remint.recipient.invalid' }),
                          },
                        ]}
                      >
                        <Input
                          placeholder={account || intl.formatMessage({ id: 'pages.zwerc721.remint.recipient.label' })}
                          maxLength={42}
                        />
                      </Form.Item>

                      <Form.Item name="redeem" valuePropName="checked" initialValue={true} hidden>
                        <Checkbox>{intl.formatMessage({ id: 'pages.zwerc721.remint.redeem' })}</Checkbox>
                      </Form.Item>

                      <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} block>
                          {intl.formatMessage({ id: 'pages.zwerc721.remint.button' })}
                        </Button>
                      </Form.Item>

                      {/* 显示交易哈希 */}
                      {simpleRemintTxHash && (
                        <div style={{ marginTop: 12, textAlign: 'center' }}>
                          <span style={{ color: '#52c41a', fontSize: '14px' }}>
                            {intl.formatMessage({ id: 'pages.zwerc721.remint.txSubmitted' })}{' '}
                            <a
                              href={`https://sepolia.etherscan.io/tx/${simpleRemintTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1890ff', textDecoration: 'underline' }}
                            >
                              {simpleRemintTxHash.substring(0, 10)}...{simpleRemintTxHash.substring(simpleRemintTxHash.length - 8)}
                            </a>
                          </span>
                        </div>
                      )}
                    </Form>
                  )}

                  <div
                    style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}
                  >
                    <h4>{intl.formatMessage({ id: 'pages.zwerc721.remint.simpleMode.tip.title' })}</h4>
                    <p>
                      <strong>{intl.formatMessage({ id: 'pages.zwerc721.remint.simpleMode.tip.what' })}</strong>
                    </p>
                    <p>{intl.formatMessage({ id: 'pages.zwerc721.remint.simpleMode.tip.whatDesc' })}</p>
                    <p>
                      <strong>{intl.formatMessage({ id: 'pages.zwerc721.remint.simpleMode.tip.how' })}</strong>
                    </p>
                    <p>{intl.formatMessage({ id: 'pages.zwerc721.remint.simpleMode.tip.step1' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwerc721.remint.simpleMode.tip.step2' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwerc721.remint.simpleMode.tip.step3' })}</p>
                    <p style={{ color: '#1890ff', marginTop: 12 }}>
                      <strong>{intl.formatMessage({ id: 'pages.zwerc721.remint.simpleMode.tip.note' })}</strong>
                      {intl.formatMessage({ id: 'pages.zwerc721.remint.simpleMode.tip.noteDesc' })}
                    </p>
                  </div>
                </div>
              </TabPane>
            </Tabs>
          </TabPane>

          {/* Advanced Mode - Includes all four Tabs */}
          <TabPane tab={intl.formatMessage({ id: 'pages.zwerc721.tab.advancedMode' })} key="advanced">
            {!CONTRACT_ADDRESSES.ZWERC721 || !CONTRACT_ADDRESSES.UnderlyingNFT ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <Empty description={intl.formatMessage({ id: 'pages.zwerc721.error.contractZWERC721NotDeployed' })} />
              </div>
            ) : (
              <Tabs 
                activeKey={activeAdvancedTab}
                onChange={(key) => setActiveAdvancedTab(key)}
                type="line" 
                style={{ marginTop: 16 }}
              >
                <TabPane tab={intl.formatMessage({ id: 'pages.zwerc721.tab.wrap' })} key="deposit">
                  <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                    <Form form={advancedDepositForm} layout="vertical" onFinish={handleAdvancedDeposit}>
                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.wrap.tokenId.label' })}
                        name="tokenId"
                        rules={[
                          { required: true, message: intl.formatMessage({ id: 'pages.zwerc721.wrap.tokenId.required' }) },
                          { type: 'number', min: 0, message: intl.formatMessage({ id: 'pages.zwerc721.wrap.tokenId.min' }) },
                        ]}
                      >
                        <InputNumber
                          style={{ width: '100%' }}
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.wrap.tokenId.placeholder' })}
                          precision={0}
                          min={0}
                          onChange={(value) => {
                            setAdvancedDepositTokenId(value ?? null);
                            if (directBurn) {
                              advancedDepositForm.setFieldsValue({ targetAddress: undefined });
                            }
                          }}
                        />
                      </Form.Item>

                      <Form.Item style={{ marginBottom: 8 }}>
                        <Checkbox
                          checked={directBurn}
                          onChange={(e) => {
                            setDirectBurn(e.target.checked);
                            if (!e.target.checked) {
                              advancedDepositForm.setFieldsValue({ targetAddress: undefined });
                            }
                          }}
                        >
                          {intl.formatMessage({ id: 'pages.zwerc721.wrap.directBurn' })}
                        </Checkbox>
                      </Form.Item>

                      {directBurn && (
                        <Form.Item
                          label={intl.formatMessage({ id: 'pages.zwerc721.wrap.privacyAddress.label' })}
                          name="targetAddress"
                          rules={[
                            { required: true, message: intl.formatMessage({ id: 'pages.zwerc721.wrap.privacyAddress.required' }) },
                            { pattern: /^0x[a-fA-F0-9]{40}$/, message: intl.formatMessage({ id: 'pages.zwerc721.wrap.privacyAddress.invalid' }) },
                          ]}
                        >
                          <Input
                            placeholder={intl.formatMessage({ id: 'pages.zwerc721.wrap.privacyAddress.placeholder' })}
                            maxLength={42}
                            addonBefore={
                              <Button
                                type="link"
                                onClick={handleAdvancedDepositGenerateClick}
                                style={{ padding: 0, height: 'auto', whiteSpace: 'nowrap' }}
                              >
                                {intl.formatMessage({ id: 'pages.zwerc721.wrap.generate' })}
                              </Button>
                            }
                          />
                        </Form.Item>
                      )}

                      <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} block>
                          {advancedNeedsApproval
                            ? 'Approve'
                            : directBurn
                              ? intl.formatMessage({ id: 'pages.zwerc721.wrap.burnButton' })
                              : intl.formatMessage({ id: 'pages.zwerc721.wrap.button' })}
                        </Button>
                      </Form.Item>

                      {advancedDepositTxHash && (
                        <div style={{ marginTop: 12, textAlign: 'center' }}>
                          <span style={{ color: '#52c41a', fontSize: '14px' }}>
                            {intl.formatMessage({ id: 'pages.zwerc721.wrap.txSubmitted' })}{' '}
                            <a
                              href={`https://sepolia.etherscan.io/tx/${advancedDepositTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1890ff', textDecoration: 'underline' }}
                            >
                              {advancedDepositTxHash.substring(0, 10)}...{advancedDepositTxHash.substring(advancedDepositTxHash.length - 8)}
                            </a>
                          </span>
                        </div>
                      )}
                    </Form>

                    <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
                      <h4>{intl.formatMessage({ id: 'pages.zwerc721.wrap.tip.title' })}</h4>
                      <p><strong>{intl.formatMessage({ id: 'pages.zwerc721.tab.wrap' }).replace('💰 ', '')}:</strong> {intl.formatMessage({ id: 'pages.zwerc721.wrap.tip.normal' })}</p>
                      <p><strong>{intl.formatMessage({ id: 'pages.zwerc721.wrap.burnButton' })}:</strong> {intl.formatMessage({ id: 'pages.zwerc721.wrap.tip.directBurn' })}</p>
                      <p>{intl.formatMessage({ id: 'pages.zwerc721.wrap.tip.twoSteps' })}</p>
                    </div>
                  </div>
                </TabPane>

                <TabPane tab={intl.formatMessage({ id: 'pages.zwerc721.tab.unwrap' })} key="withdraw">
                  <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                    <Form form={withdrawForm} layout="vertical" onFinish={handleWithdraw}>
                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.unwrap.tokenId.label' })}
                        name="tokenId"
                        rules={[
                          { required: true, message: intl.formatMessage({ id: 'pages.zwerc721.unwrap.tokenId.required' }) },
                          { type: 'number', min: 0, message: intl.formatMessage({ id: 'pages.zwerc721.unwrap.tokenId.min' }) },
                        ]}
                      >
                        <InputNumber
                          style={{ width: '100%' }}
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.unwrap.tokenId.placeholder' })}
                          precision={0}
                          min={0}
                        />
                      </Form.Item>

                      <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} block>
                          {intl.formatMessage({ id: 'pages.zwerc721.unwrap.button' })}
                        </Button>
                      </Form.Item>

                      {advancedWithdrawTxHash && (
                        <div style={{ marginTop: 12, textAlign: 'center' }}>
                          <span style={{ color: '#52c41a', fontSize: '14px' }}>
                            {intl.formatMessage({ id: 'pages.zwerc721.unwrap.txSubmitted' })}{' '}
                            <a
                              href={`https://sepolia.etherscan.io/tx/${advancedWithdrawTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1890ff', textDecoration: 'underline' }}
                            >
                              {advancedWithdrawTxHash.substring(0, 10)}...{advancedWithdrawTxHash.substring(advancedWithdrawTxHash.length - 8)}
                            </a>
                          </span>
                        </div>
                      )}
                    </Form>

                    <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
                      <h4>{intl.formatMessage({ id: 'pages.zwerc721.unwrap.tip.title' })}</h4>
                      <p><strong>{intl.formatMessage({ id: 'pages.zwerc721.unwrap.tip.what' })}</strong>{intl.formatMessage({ id: 'pages.zwerc721.unwrap.tip.desc1' })}</p>
                      <p>{intl.formatMessage({ id: 'pages.zwerc721.unwrap.tip.desc2' })}</p>
                    </div>
                  </div>
                </TabPane>

                <TabPane tab={intl.formatMessage({ id: 'pages.zwerc721.tab.transfer' })} key="transfer">
                  <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                    <Form form={transferForm} layout="vertical" onFinish={handleTransfer}>
                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.transfer.tokenId.label' })}
                        name="tokenId"
                        rules={[
                          { required: true, message: intl.formatMessage({ id: 'pages.zwerc721.transfer.tokenId.required' }) },
                          { type: 'number', min: 0, message: intl.formatMessage({ id: 'pages.zwerc721.transfer.tokenId.min' }) },
                        ]}
                      >
                        <InputNumber
                          style={{ width: '100%' }}
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.transfer.tokenId.placeholder' })}
                          precision={0}
                          min={0}
                          onChange={() => {
                            transferForm.setFieldsValue({ targetAddress: undefined });
                            setTransferBurnAddress(null);
                          }}
                        />
                      </Form.Item>

                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.transfer.targetAddress.label' })}
                        name="targetAddress"
                        rules={[
                          { required: true, message: intl.formatMessage({ id: 'pages.zwerc721.transfer.targetAddress.required' }) },
                          { pattern: /^0x[a-fA-F0-9]{40}$/, message: intl.formatMessage({ id: 'pages.zwerc721.transfer.targetAddress.invalid' }) },
                        ]}
                      >
                        <Input
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.transfer.targetAddress.placeholder' })}
                          maxLength={42}
                          addonBefore={
                            <Button
                              type="link"
                              onClick={handleBurnClick}
                              style={{ padding: 0, height: 'auto', whiteSpace: 'nowrap' }}
                            >
                              {intl.formatMessage({ id: 'pages.zwerc721.transfer.generatePrivacy' })}
                            </Button>
                          }
                        />
                      </Form.Item>

                      <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} block>
                          {intl.formatMessage({ id: 'pages.zwerc721.transfer.button' })}
                        </Button>
                      </Form.Item>

                      {advancedTransferTxHash && (
                        <div style={{ marginTop: 12, textAlign: 'center' }}>
                          <span style={{ color: '#52c41a', fontSize: '14px' }}>
                            {intl.formatMessage({ id: 'pages.zwerc721.transfer.txSubmitted' })}{' '}
                            <a
                              href={`https://sepolia.etherscan.io/tx/${advancedTransferTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1890ff', textDecoration: 'underline' }}
                            >
                              {advancedTransferTxHash.substring(0, 10)}...{advancedTransferTxHash.substring(advancedTransferTxHash.length - 8)}
                            </a>
                          </span>
                        </div>
                      )}
                    </Form>

                    <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
                      <h4>{intl.formatMessage({ id: 'pages.zwerc721.transfer.tip.title' })}</h4>
                      <p>{intl.formatMessage({ id: 'pages.zwerc721.transfer.tip.normal' })}</p>
                      <p>{intl.formatMessage({ id: 'pages.zwerc721.transfer.tip.privacy' })}</p>
                      <p>{intl.formatMessage({ id: 'pages.zwerc721.transfer.tip.afterTransfer' })}</p>
                    </div>
                  </div>
                </TabPane>

                <TabPane tab={intl.formatMessage({ id: 'pages.zwerc721.tab.advancedRemint' })} key="remint">
                  <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                    <Form
                      form={advancedRemintForm}
                      layout="vertical"
                      onFinish={handleRemint}
                      initialValues={{
                        recipient: account || undefined,
                        redeem: false,
                      }}
                    >
                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.remint.tokenId.label' })}
                        name="tokenId"
                        rules={[
                          { required: true, message: intl.formatMessage({ id: 'pages.zwerc721.remint.tokenId.required' }) },
                          { type: 'number', min: 0, message: intl.formatMessage({ id: 'pages.zwerc721.remint.tokenId.min' }) },
                        ]}
                      >
                        <InputNumber
                          style={{ width: '100%' }}
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.remint.tokenId.placeholder' })}
                          precision={0}
                          min={0}
                        />
                      </Form.Item>

                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.remint.secret.label' })}
                        name="secret"
                        rules={[{ required: true, message: intl.formatMessage({ id: 'pages.zwerc721.remint.secret.required' }) }]}
                      >
                        <Input.Password
                          placeholder={intl.formatMessage({ id: 'pages.zwerc721.advancedRemint.secret.placeholder' })}
                          addonBefore={
                            <Button
                              type="link"
                              onClick={handleAdvancedRemintGenerateBySeedClick}
                              style={{ padding: 0, height: 'auto', whiteSpace: 'nowrap' }}
                            >
                              {isMobile ? intl.formatMessage({ id: 'pages.zwerc721.remint.selectMobile' }) : intl.formatMessage({ id: 'pages.zwerc721.remint.selectBySeed' })}
                            </Button>
                          }
                        />
                      </Form.Item>

                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwerc721.remint.recipient.label' })}
                        name="recipient"
                        rules={[
                          { required: true, message: intl.formatMessage({ id: 'pages.zwerc721.remint.recipient.required' }) },
                          { pattern: /^0x[a-fA-F0-9]{40}$/, message: intl.formatMessage({ id: 'pages.zwerc721.remint.recipient.invalid' }) },
                        ]}
                      >
                        <Input
                          placeholder={account || intl.formatMessage({ id: 'pages.zwerc721.remint.recipient.label' })}
                          maxLength={42}
                        />
                      </Form.Item>

                      <Form.Item name="redeem" valuePropName="checked">
                        <Checkbox>
                          <span>{intl.formatMessage({ id: 'pages.zwerc721.remint.redeem' })}</span>
                          <Tooltip title={intl.formatMessage({ id: 'pages.zwerc721.remint.redeemTooltip' })}>
                            <InfoCircleOutlined style={{ marginLeft: 6, color: '#1890ff', cursor: 'pointer' }} />
                          </Tooltip>
                        </Checkbox>
                      </Form.Item>

                      <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} block>
                          {intl.formatMessage({ id: 'pages.zwerc721.remint.button' })}
                        </Button>
                      </Form.Item>

                      {advancedRemintTxHash && (
                        <div style={{ marginTop: 12, textAlign: 'center' }}>
                          <span style={{ color: '#52c41a', fontSize: '14px' }}>
                            {intl.formatMessage({ id: 'pages.zwerc721.remint.txSubmitted' })}{' '}
                            <a
                              href={`https://sepolia.etherscan.io/tx/${advancedRemintTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1890ff', textDecoration: 'underline' }}
                            >
                              {advancedRemintTxHash.substring(0, 10)}...{advancedRemintTxHash.substring(advancedRemintTxHash.length - 8)}
                            </a>
                          </span>
                        </div>
                      )}
                    </Form>

                    <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
                      <h4>{intl.formatMessage({ id: 'pages.zwerc721.advancedRemint.tip.title' })}</h4>
                      <p><strong>{intl.formatMessage({ id: 'pages.zwerc721.advancedRemint.tip.what' })}</strong></p>
                      <p>{intl.formatMessage({ id: 'pages.zwerc721.advancedRemint.tip.whatDesc' })}</p>
                      <p><strong>{intl.formatMessage({ id: 'pages.zwerc721.advancedRemint.tip.redeem' })}</strong></p>
                      <p>• {intl.formatMessage({ id: 'pages.zwerc721.advancedRemint.tip.redeemOff' })}</p>
                      <p>• {intl.formatMessage({ id: 'pages.zwerc721.advancedRemint.tip.redeemOn' })}</p>
                      <p>{intl.formatMessage({ id: 'pages.zwerc721.advancedRemint.tip.time' })}</p>
                    </div>
                  </div>
                </TabPane>
              </Tabs>
            )}
          </TabPane>

          {/* Tutorial Tab */}
          <TabPane tab="Tutorial" key="tutorial">
            <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 0' }}>
              <div
                style={{
                  position: 'relative',
                  paddingBottom: '56.25%' /* 16:9 aspect ratio */,
                  height: 0,
                  overflow: 'hidden',
                  maxWidth: '100%',
                  background: '#000',
                }}
              >
                <iframe
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 0,
                  }}
                  src="https://www.youtube.com/embed/aH_Q9idI2Uw?si=4B99x1e1WapJRQe2&cc_load_policy=1"
                  title="YouTube video player"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            </div>
            <div
                style={{
                  position: 'relative',
                  paddingBottom: '56.25%',
                  height: 0,
                  overflow: 'hidden',
                  maxWidth: '100%',
                  background: '#000',
                  marginTop: 24,
                }}
              >
                <iframe
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 0,
                  }}
                  src="https://www.youtube.com/embed/3Lh7JqpIVL8?si=nyKi4bjIWGzXdfNW"
                  title="YouTube video player"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
              <div
                style={{
                  position: 'relative',
                  paddingBottom: '56.25%',
                  height: 0,
                  overflow: 'hidden',
                  maxWidth: '100%',
                  background: '#000',
                  marginTop: 24,
                }}
              >
                <iframe
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 0,
                  }}
                  src="https://www.youtube.com/embed/yyWCOpfki_Q?si=bUy3GZ1WTbR4md4V&start=9539"
                  title="YouTube video player"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
          </TabPane>
        </Tabs>
      </Card>

      {/* Faucet Modal */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.title' })}
        open={faucetModalVisible}
        onCancel={() => setFaucetModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setFaucetModalVisible(false)}>
            {intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.cancel' })}
          </Button>,
          <Button
            key="mint"
            type="primary"
            loading={faucetLoading}
            onClick={handleFaucetMint}
          >
            {intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.mint' })}
          </Button>,
        ]}
      >
        <div style={{ padding: '20px 0' }}>
          <div style={{ marginBottom: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎁</div>
            <p style={{ fontSize: 16, color: '#666', marginBottom: 8 }}>
              {intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.subtitle' })}
            </p>
            {account && (
              <div
                style={{
                  padding: 12,
                  background: '#f5f5f5',
                  borderRadius: 4,
                  marginTop: 16,
                  wordBreak: 'break-all',
                }}
              >
                <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                  {intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.recipientAddress' })}
                </div>
                <div style={{ fontSize: 14, fontFamily: 'monospace', color: '#1890ff' }}>
                  {account}
                </div>
              </div>
            )}
          </div>

          <div style={{ background: '#e6f7ff', padding: 16, borderRadius: 4, border: '1px solid #91d5ff' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <InfoCircleOutlined style={{ color: '#1890ff', marginTop: 2 }} />
              <div style={{ fontSize: 12, color: '#666' }}>
                <p style={{ margin: '0 0 8px 0' }}>
                  <strong>{intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.infoTitle' })}</strong>
                </p>
                <p style={{ margin: '0 0 4px 0' }}>
                  • {intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.info1' })}
                </p>
                <p style={{ margin: '0 0 4px 0' }}>
                  • {intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.info2' })}
                </p>
                <p style={{ margin: '0 0 4px 0' }}>
                  • {intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.info3' })}
                </p>
                <p style={{ margin: 0 }}>
                  • {intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.info4' })}
                </p>
              </div>
            </div>
          </div>

          {CONTRACT_ADDRESSES.ERC721Faucet && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <a
                href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.ERC721Faucet}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#1890ff' }}
              >
                {intl.formatMessage({ id: 'pages.zwerc721.faucet.modal.viewContract' })}
              </a>
            </div>
          )}
        </div>
      </Modal>

      {/* Simple Mode Deposit Secret Modal */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwerc721.secretModal.deposit.title' })}
        open={depositSecretModalVisible}
        onCancel={() => {
          setDepositSecretModalVisible(false);
          depositSecretForm.resetFields();
          setSeed('');
          setDepositSecretList([]);
        }}
        footer={null}
        width={900}
      >
        {depositSecretList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <p>{intl.formatMessage({ id: 'pages.zwerc721.secretModal.scanning' })}</p>
          </div>
        ) : (
          <div>
            <Table
              dataSource={depositSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.index' }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 60,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.secret' }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success(intl.formatMessage({ id: 'pages.zwerc721.message.secretCopied' }));
                          } else {
                            message.error(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.copyFailed' }));
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.nftCount' }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 200,
                  render: (amount: string, record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.checking' })}</span>;
                    }
                    if (amount === intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })) {
                      return <span style={{ color: '#ff4d4f' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })}</span>;
                    }
                    if (amount.startsWith('0 NFT')) {
                      return <span style={{ color: '#52c41a' }}>{amount}</span>;
                    }
                    return <span style={{ color: '#faad14', fontWeight: 'bold' }}>{amount}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.claimed' }),
                  dataIndex: 'claimedTokenIds',
                  key: 'claimedTokenIds',
                  width: 100,
                  align: 'center',
                  render: (claimedTokenIds: number[], record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (!claimedTokenIds || claimedTokenIds.length === 0) {
                      return <span style={{ color: '#52c41a' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.available' })}</span>;
                    }
                    return <span style={{ color: '#999', fontWeight: 'bold' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.claimedWithIds' }, { ids: claimedTokenIds.join(', ') })}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.action' }),
                  key: 'action',
                  width: 80,
                  align: 'center',
                  render: (_: any, record: any) => {
                    const currentTokenId = simpleDepositForm.getFieldValue('tokenId');
                    const tokenIdClaimed = currentTokenId !== undefined && currentTokenId !== null &&
                      record.claimedTokenIds && record.claimedTokenIds.includes(Number(currentTokenId));
                    return (
                      <Button
                        type={tokenIdClaimed ? 'default' : 'primary'}
                        size="small"
                        onClick={() => handleSelectDepositSecret(record.secret)}
                        disabled={record.loading || tokenIdClaimed}
                        title={tokenIdClaimed ? `Token ID ${currentTokenId}` : intl.formatMessage({ id: 'pages.zwerc721.table.selectAddress' })}
                      >
                        {intl.formatMessage({ id: 'pages.zwerc721.table.select' })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwerc721.table.depositTip' })}
            </p>
          </div>
        )}
      </Modal>

      {/* Advanced Mode Deposit Secret Modal */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwerc721.secretModal.advancedDeposit.title' })}
        open={advancedDepositSecretModalVisible}
        onCancel={() => {
          setAdvancedDepositSecretModalVisible(false);
          advancedDepositSecretForm.resetFields();
          setSeed('');
          setAdvancedDepositSecretList([]);
          setAdvancedDepositSecretMode(undefined);
        }}
        footer={null}
        width={1000}
      >
        {/* Mode Selection Buttons */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <Button
            type={advancedDepositSecretMode === 'seed' ? 'primary' : 'default'}
            onClick={() => {
              setAdvancedDepositSecretMode('seed');
              if (advancedDepositSecretList.length === 0) {
                handleGenerateBySeed('advancedDeposit');
              }
            }}
            size="large"
            style={{ flex: 1 }}
          >
            {intl.formatMessage({ id: 'pages.zwerc721.secretModal.useSeed' })}
          </Button>
          <Button
            type={advancedDepositSecretMode === 'manual' ? 'primary' : 'default'}
            onClick={() => {
              setAdvancedDepositSecretMode('manual');
              setAdvancedDepositSecretList([]);
            }}
            size="large"
            style={{ flex: 1 }}
          >
            {intl.formatMessage({ id: 'pages.zwerc721.secretModal.manual' })}
          </Button>
        </div>

        {/* Manual Input Mode */}
        {advancedDepositSecretMode === 'manual' && (
          <div>
            <Form form={advancedDepositSecretForm} layout="vertical">
              <Form.Item
                label={intl.formatMessage({ id: 'pages.zwerc721.secretModal.secret.label' })}
                name="secret"
                rules={[
                  { required: true, message: intl.formatMessage({ id: 'pages.zwerc721.secretModal.secret.required' }) },
                  { pattern: /^\d+$/, message: intl.formatMessage({ id: 'pages.zwerc721.secretModal.secret.invalid' }) },
                ]}
              >
                <Input placeholder={intl.formatMessage({ id: 'pages.zwerc721.secretModal.secret.placeholder' })} />
              </Form.Item>
              <Button type="primary" onClick={handleAdvancedDepositSecretConfirm} block size="large">
                {intl.formatMessage({ id: 'pages.zwerc721.secretModal.confirm' })}
              </Button>
            </Form>
            <p style={{ color: '#666', fontSize: '12px', marginTop: 12 }}>
              {intl.formatMessage({ id: 'pages.zwerc721.secretModal.keepSafe' })}
            </p>
          </div>
        )}

        {/* Seed Mode - Loading */}
        {advancedDepositSecretMode === 'seed' && advancedDepositSecretList.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <p>{intl.formatMessage({ id: 'pages.zwerc721.secretModal.scanning' })}</p>
          </div>
        )}

        {/* Seed Mode - Secret List */}
        {advancedDepositSecretMode === 'seed' && advancedDepositSecretList.length > 0 && (
          <div>
            <Table
              dataSource={advancedDepositSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.index' }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 60,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.secret' }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success(intl.formatMessage({ id: 'pages.zwerc721.message.secretCopied' }));
                          } else {
                            message.error(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.copyFailed' }));
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.nftCount' }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 200,
                  render: (amount: string, record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.checking' })}</span>;
                    }
                    if (amount === intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })) {
                      return <span style={{ color: '#ff4d4f' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })}</span>;
                    }
                    if (amount.startsWith('0 NFT')) {
                      return <span style={{ color: '#52c41a' }}>{amount}</span>;
                    }
                    return <span style={{ color: '#faad14', fontWeight: 'bold' }}>{amount}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.claimed' }),
                  dataIndex: 'claimedTokenIds',
                  key: 'claimedTokenIds',
                  width: 100,
                  align: 'center',
                  render: (claimedTokenIds: number[], record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (!claimedTokenIds || claimedTokenIds.length === 0) {
                      return <span style={{ color: '#52c41a' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.available' })}</span>;
                    }
                    return <span style={{ color: '#999', fontWeight: 'bold' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.claimedWithIds' }, { ids: claimedTokenIds.join(', ') })}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.action' }),
                  key: 'action',
                  width: 80,
                  align: 'center',
                  render: (_: any, record: any) => {
                    const currentTokenId = advancedDepositForm.getFieldValue('tokenId');
                    const tokenIdClaimed = currentTokenId !== undefined && currentTokenId !== null &&
                      record.claimedTokenIds && record.claimedTokenIds.includes(Number(currentTokenId));
                    return (
                      <Button
                        type={tokenIdClaimed ? 'default' : 'primary'}
                        size="small"
                        onClick={() => handleSelectAdvancedDepositSecret(record.secret)}
                        disabled={record.loading || tokenIdClaimed}
                        title={tokenIdClaimed ? `Token ID ${currentTokenId}` : intl.formatMessage({ id: 'pages.zwerc721.table.selectAddress' })}
                      >
                        {intl.formatMessage({ id: 'pages.zwerc721.table.select' })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwerc721.table.depositTip' })}
            </p>
          </div>
        )}
      </Modal>

      {/* Transfer Secret Modal */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwerc721.secretModal.transfer.title' })}
        open={secretModalVisible}
        onCancel={() => {
          setSecretModalVisible(false);
          secretForm.resetFields();
          setSeed('');
          setSecretList([]);
          setTransferSecretMode(undefined);
        }}
        footer={null}
        width={1000}
      >
        {/* Mode Selection Buttons */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <Button
            type={transferSecretMode === 'seed' ? 'primary' : 'default'}
            onClick={() => {
              setTransferSecretMode('seed');
              if (secretList.length === 0) {
                handleGenerateBySeed('transfer');
              }
            }}
            size="large"
            style={{ flex: 1 }}
          >
            {intl.formatMessage({ id: 'pages.zwerc721.secretModal.useSeed' })}
          </Button>
          <Button
            type={transferSecretMode === 'manual' ? 'primary' : 'default'}
            onClick={() => {
              setTransferSecretMode('manual');
              setSecretList([]);
            }}
            size="large"
            style={{ flex: 1 }}
          >
            {intl.formatMessage({ id: 'pages.zwerc721.secretModal.manual' })}
          </Button>
        </div>

        {/* Manual Input Mode */}
        {transferSecretMode === 'manual' && (
          <div>
            <Form form={secretForm} layout="vertical">
              <Form.Item
                label={intl.formatMessage({ id: 'pages.zwerc721.secretModal.secret.label' })}
                name="secret"
                rules={[
                  { required: true, message: intl.formatMessage({ id: 'pages.zwerc721.secretModal.secret.required' }) },
                  { pattern: /^\d+$/, message: intl.formatMessage({ id: 'pages.zwerc721.secretModal.secret.invalid' }) },
                ]}
              >
                <Input placeholder={intl.formatMessage({ id: 'pages.zwerc721.secretModal.secret.placeholder' })} />
              </Form.Item>
              <Button type="primary" onClick={handleSecretConfirm} block size="large">
                {intl.formatMessage({ id: 'pages.zwerc721.secretModal.confirm' })}
              </Button>
            </Form>
            <p style={{ color: '#666', fontSize: '12px', marginTop: 12 }}>
              {intl.formatMessage({ id: 'pages.zwerc721.secretModal.keepSafe' })}
            </p>
          </div>
        )}

        {/* Seed Mode - Loading */}
        {transferSecretMode === 'seed' && secretList.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <p>{intl.formatMessage({ id: 'pages.zwerc721.secretModal.scanning' })}</p>
          </div>
        )}

        {/* Seed Mode - Secret List */}
        {transferSecretMode === 'seed' && secretList.length > 0 && (
          <div>
            <Table
              dataSource={secretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.index' }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 60,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.secret' }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success(intl.formatMessage({ id: 'pages.zwerc721.message.secretCopied' }));
                          } else {
                            message.error(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.copyFailed' }));
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.nftCount' }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 200,
                  render: (amount: string, record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.checking' })}</span>;
                    }
                    if (amount === intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })) {
                      return <span style={{ color: '#ff4d4f' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })}</span>;
                    }
                    if (amount.startsWith('0 NFT')) {
                      return <span style={{ color: '#52c41a' }}>{amount}</span>;
                    }
                    return <span style={{ color: '#faad14', fontWeight: 'bold' }}>{amount}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.claimed' }),
                  dataIndex: 'claimedTokenIds',
                  key: 'claimedTokenIds',
                  width: 100,
                  align: 'center',
                  render: (claimedTokenIds: number[], record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (!claimedTokenIds || claimedTokenIds.length === 0) {
                      return <span style={{ color: '#52c41a' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.available' })}</span>;
                    }
                    return <span style={{ color: '#999', fontWeight: 'bold' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.claimedWithIds' }, { ids: claimedTokenIds.join(', ') })}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.action' }),
                  key: 'action',
                  width: 80,
                  align: 'center',
                  render: (_: any, record: any) => {
                    const currentTokenId = transferForm.getFieldValue('tokenId');
                    const tokenIdClaimed = currentTokenId !== undefined && currentTokenId !== null &&
                      record.claimedTokenIds && record.claimedTokenIds.includes(Number(currentTokenId));
                    return (
                      <Button
                        type={tokenIdClaimed ? 'default' : 'primary'}
                        size="small"
                        onClick={() => handleSelectSecret(record.secret)}
                        disabled={record.loading || tokenIdClaimed}
                        title={tokenIdClaimed ? `Token ID ${currentTokenId}` : intl.formatMessage({ id: 'pages.zwerc721.table.selectAddress' })}
                      >
                        {intl.formatMessage({ id: 'pages.zwerc721.table.select' })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwerc721.table.transferTip' })}
            </p>
          </div>
        )}
      </Modal>

      {/* Simple Mode Remint Secret Modal */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwerc721.secretModal.remint.title' })}
        open={remintSeedModalVisible}
        onCancel={() => {
          setRemintSeedModalVisible(false);
          setRemintSecretList([]);
        }}
        footer={[
          <Button key="close" onClick={() => setRemintSeedModalVisible(false)}>
            {intl.formatMessage({ id: 'pages.zwerc721.secretModal.close' })}
          </Button>,
        ]}
        width={1000}
      >
        {remintSecretList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <p>{intl.formatMessage({ id: 'pages.zwerc721.secretModal.scanning' })}</p>
          </div>
        ) : (
          <div>
            <Table
              dataSource={remintSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.index' }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 60,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.secret' }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success(intl.formatMessage({ id: 'pages.zwerc721.message.secretCopied' }));
                          } else {
                            message.error(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.copyFailed' }));
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.nftCount' }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 200,
                  render: (amount: string, record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.checking' })}</span>;
                    }
                    if (amount === intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })) {
                      return <span style={{ color: '#ff4d4f' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })}</span>;
                    }
                    if (amount.startsWith('0 NFT')) {
                      return <span style={{ color: '#999' }}>{amount}</span>;
                    }
                    return <span style={{ color: '#faad14', fontWeight: 'bold' }}>{amount}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.claimed' }),
                  dataIndex: 'claimedTokenIds',
                  key: 'claimedTokenIds',
                  width: 100,
                  align: 'center',
                  render: (claimedTokenIds: number[], record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (!claimedTokenIds || claimedTokenIds.length === 0) {
                      return <span style={{ color: '#52c41a' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.available' })}</span>;
                    }
                    return <span style={{ color: '#999', fontWeight: 'bold' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.claimedWithIds' }, { ids: claimedTokenIds.join(', ') })}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.action' }),
                  key: 'action',
                  width: 80,
                  align: 'center',
                  render: (_: any, record: any) => {
                    const queryFailedStr = intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' });
                    const hasNfts = record.amount && !record.amount.startsWith('0 NFT') && record.amount !== queryFailedStr;
                    return (
                      <Button
                        type={hasNfts ? 'primary' : 'default'}
                        size="small"
                        onClick={() => handleSelectRemintSecret(record.secret)}
                        disabled={record.loading || !hasNfts}
                        title={!hasNfts ? intl.formatMessage({ id: 'pages.zwerc721.table.noNft' }) : intl.formatMessage({ id: 'pages.zwerc721.table.selectSecret' })}
                      >
                        {intl.formatMessage({ id: 'pages.zwerc721.table.select' })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwerc721.table.remintTip' })}
            </p>
          </div>
        )}
      </Modal>

      {/* Advanced Mode Remint Secret Modal */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwerc721.secretModal.advancedRemint.title' })}
        open={advancedRemintSeedModalVisible}
        onCancel={() => {
          setAdvancedRemintSeedModalVisible(false);
          setAdvancedRemintSecretList([]);
        }}
        footer={[
          <Button key="close" onClick={() => setAdvancedRemintSeedModalVisible(false)}>
            {intl.formatMessage({ id: 'pages.zwerc721.secretModal.close' })}
          </Button>,
        ]}
        width={1000}
      >
        {advancedRemintSecretList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <p>{intl.formatMessage({ id: 'pages.zwerc721.secretModal.scanning' })}</p>
          </div>
        ) : (
          <div>
            <Table
              dataSource={advancedRemintSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.index' }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 60,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.secret' }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success(intl.formatMessage({ id: 'pages.zwerc721.message.secretCopied' }));
                          } else {
                            message.error(intl.formatMessage({ id: 'pages.zwerc721.lastBurn.copyFailed' }));
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.nftCount' }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 200,
                  render: (amount: string, record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.checking' })}</span>;
                    }
                    if (amount === intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })) {
                      return <span style={{ color: '#ff4d4f' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' })}</span>;
                    }
                    if (amount.startsWith('0 NFT')) {
                      return <span style={{ color: '#999' }}>{amount}</span>;
                    }
                    return <span style={{ color: '#faad14', fontWeight: 'bold' }}>{amount}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.claimed' }),
                  dataIndex: 'claimedTokenIds',
                  key: 'claimedTokenIds',
                  width: 100,
                  align: 'center',
                  render: (claimedTokenIds: number[], record: any) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (!claimedTokenIds || claimedTokenIds.length === 0) {
                      return <span style={{ color: '#52c41a' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.available' })}</span>;
                    }
                    return <span style={{ color: '#999', fontWeight: 'bold' }}>{intl.formatMessage({ id: 'pages.zwerc721.table.claimedWithIds' }, { ids: claimedTokenIds.join(', ') })}</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwerc721.table.action' }),
                  key: 'action',
                  width: 80,
                  align: 'center',
                  render: (_: any, record: any) => {
                    const queryFailedStr = intl.formatMessage({ id: 'pages.zwerc721.table.queryFailed' });
                    const hasNfts = record.amount && !record.amount.startsWith('0 NFT') && record.amount !== queryFailedStr;
                    return (
                      <Button
                        type={hasNfts ? 'primary' : 'default'}
                        size="small"
                        onClick={() => handleSelectAdvancedRemintSecret(record.secret)}
                        disabled={record.loading || !hasNfts}
                        title={!hasNfts ? intl.formatMessage({ id: 'pages.zwerc721.table.noNft' }) : intl.formatMessage({ id: 'pages.zwerc721.table.selectSecret' })}
                      >
                        {intl.formatMessage({ id: 'pages.zwerc721.table.select' })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwerc721.table.remintTip' })}
            </p>
          </div>
        )}
      </Modal>
    </PageContainer>
    </>
  );
};

export default ZWERC721;
