import { GithubOutlined } from '@ant-design/icons';
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

  // Preload circuit files
  useEffect(() => {
    const preloadCircuits = async () => {
      try {
        console.log('Starting to preload circuit files...');
        setCircuitsProgress(0);

        // Load wasm file
        const wasmResponse = await fetch('/circuits/remint.wasm');
        const wasmTotal = Number(wasmResponse.headers.get('content-length')) || 0;
        const wasmReader = wasmResponse.body?.getReader();

        let wasmReceived = 0;

        if (wasmReader) {
          while (true) {
            const { done, value } = await wasmReader.read();
            if (done) break;

            wasmReceived += value.length;

            // Update progress (wasm takes 50%)
            if (wasmTotal > 0) {
              setCircuitsProgress(Math.floor((wasmReceived / wasmTotal) * 50));
            }
          }
        }

        console.log('Wasm file loaded');
        setCircuitsProgress(50);

        // Load zkey file
        const zkeyResponse = await fetch('/circuits/remint_final.zkey');
        const zkeyTotal = Number(zkeyResponse.headers.get('content-length')) || 0;
        const zkeyReader = zkeyResponse.body?.getReader();

        let zkeyReceived = 0;

        if (zkeyReader) {
          while (true) {
            const { done, value } = await zkeyReader.read();
            if (done) break;

            zkeyReceived += value.length;

            // Update progress (zkey takes 50%)
            if (zkeyTotal > 0) {
              setCircuitsProgress(50 + Math.floor((zkeyReceived / zkeyTotal) * 50));
            }
          }
        }

        console.log('Zkey file loaded');

        setCircuitsProgress(100);
        setCircuitsLoaded(true);

        console.log('✅ All circuit files preloaded');
      } catch (error) {
        console.error('Failed to preload circuit files:', error);
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
      {/* Circuits status display */}
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

      {/* GitHub icon */}
      <GithubOutlined
        style={{ fontSize: '16px', cursor: 'pointer' }}
        onClick={() => {
          window.open('https://github.com/0xNullLabs/ZWToken/');
        }}
      />
    </div>
  );
};
