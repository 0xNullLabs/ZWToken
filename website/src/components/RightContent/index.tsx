import { QuestionCircleOutlined } from '@ant-design/icons';
import { SelectLang as UmiSelectLang } from '@umijs/max';
import React, { useState, useEffect } from 'react';

export type SiderTheme = 'light' | 'dark';

export const SelectLang = () => {
  return (
    <UmiSelectLang
      style={{
        padding: 4,
      }}
    />
  );
};

export const Question = () => {
  const [circuitsLoaded, setCircuitsLoaded] = useState(false);
  const [circuitsProgress, setCircuitsProgress] = useState(0);

  // 预加载电路文件
  useEffect(() => {
    const preloadCircuits = async () => {
      try {
        console.log('开始预加载电路文件...');
        setCircuitsProgress(0);
        
        // 加载 wasm 文件
        const wasmResponse = await fetch('/circuits/remint.wasm');
        const wasmTotal = Number(wasmResponse.headers.get('content-length')) || 0;
        const wasmReader = wasmResponse.body?.getReader();
        
        let wasmReceived = 0;
        
        if (wasmReader) {
          while (true) {
            const { done, value } = await wasmReader.read();
            if (done) break;
            
            wasmReceived += value.length;
            
            // 更新进度 (wasm 占 50%)
            if (wasmTotal > 0) {
              setCircuitsProgress(Math.floor((wasmReceived / wasmTotal) * 50));
            }
          }
        }
        
        console.log('Wasm 文件加载完成');
        setCircuitsProgress(50);
        
        // 加载 zkey 文件
        const zkeyResponse = await fetch('/circuits/remint_final.zkey');
        const zkeyTotal = Number(zkeyResponse.headers.get('content-length')) || 0;
        const zkeyReader = zkeyResponse.body?.getReader();
        
        let zkeyReceived = 0;
        
        if (zkeyReader) {
          while (true) {
            const { done, value } = await zkeyReader.read();
            if (done) break;
            
            zkeyReceived += value.length;
            
            // 更新进度 (zkey 占 50%)
            if (zkeyTotal > 0) {
              setCircuitsProgress(50 + Math.floor((zkeyReceived / zkeyTotal) * 50));
            }
          }
        }
        
        console.log('Zkey 文件加载完成');
        
        setCircuitsProgress(100);
        setCircuitsLoaded(true);
        
        console.log('✅ 所有电路文件预加载完成');
      } catch (error) {
        console.error('预加载电路文件失败:', error);
      }
    };

    preloadCircuits();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        height: 26,
      }}
    >
      {/* Circuits 状态显示 */}
      {!circuitsLoaded ? (
        <span
          style={{
            fontSize: '14px',
            color: '#faad14',
            fontWeight: 500,
          }}
        >
          Circuits:{circuitsProgress}%
        </span>
      ) : (
        <span
          style={{
            fontSize: '14px',
            color: '#52c41a',
            fontWeight: 500,
          }}
        >
          Circuits:100%
        </span>
      )}
      
      {/* Question 图标 */}
      <QuestionCircleOutlined
        style={{ fontSize: '16px', cursor: 'pointer' }}
        onClick={() => {
          window.open('https://github.com/your-repo/ZWToken');
        }}
      />
    </div>
  );
};
