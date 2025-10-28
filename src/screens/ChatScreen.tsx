import React, { useContext, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SettingsContext } from '../../App';
import { streamChat, ChatMessage, ping } from '../lib/ollamaClient';

export default function ChatScreen() {
  const { settings } = useContext(SettingsContext);
  const baseUrl = useMemo(() => `http://${settings.host}:${settings.port}`, [settings.host, settings.port]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const streamRef = useRef<{ cancel: () => void } | null>(null);

  const send = async () => {
    if (!input.trim() || isStreaming) return;
    setError(null);

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');

    // Seed an assistant message we will stream into
  setMessages((prev: ChatMessage[]) => [...prev, { role: 'assistant', content: '' }]);
    
    // Preflight connectivity check to provide actionable errors
    const ok = await ping(baseUrl);
    if (!ok) {
      setError(`Cannot reach Ollama at ${baseUrl}. On Android emulator use http://10.0.2.2:11434; on device use your PC's LAN IP and run Ollama bound to 0.0.0.0.`);
      return;
    }

    setIsStreaming(true);

    const handle = streamChat({
      baseUrl,
      model: settings.model,
      messages: history,
      onToken: (t) => {
        setMessages((prev: ChatMessage[]) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx >= 0 && next[lastIdx].role === 'assistant') {
            next[lastIdx] = { ...next[lastIdx], content: next[lastIdx].content + t };
          }
          return next;
        });
        scrollRef.current?.scrollToEnd({ animated: true });
      },
      onError: (e) => {
        setError(String(e?.message || e));
        setIsStreaming(false);
      },
      onDone: () => setIsStreaming(false),
    });

    streamRef.current = handle;
  };

  const stop = () => {
    streamRef.current?.cancel();
    setIsStreaming(false);
  };

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.messages}>
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? styles.user : styles.assistant]}>
            <Text style={styles.bubbleText}>{m.content || (m.role === 'assistant' && isStreaming ? '…' : '')}</Text>
          </View>
        ))}
      </ScrollView>

      {error ? (
        <Text style={styles.error}>Error: {error}</Text>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={`Message (${settings.model})`}
          editable={!isStreaming}
        />
        {isStreaming ? (
          <TouchableOpacity onPress={stop} style={[styles.button, styles.stop]}>
            <Text style={styles.buttonText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={send} style={styles.button}>
            <Text style={styles.buttonText}>Send</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.hint}>Connect your phone and Ollama host to the same LAN. Endpoint: {baseUrl}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messages: { padding: 12 },
  bubble: {
    padding: 10,
    borderRadius: 10,
    marginVertical: 6,
    maxWidth: '85%',
  },
  user: { alignSelf: 'flex-end', backgroundColor: '#DCF8C6' },
  assistant: { alignSelf: 'flex-start', backgroundColor: '#eee' },
  bubbleText: { fontSize: 16, color: '#111' },
  inputRow: { flexDirection: 'row', padding: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd' },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  button: { backgroundColor: '#007AFF', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 8 },
  stop: { backgroundColor: '#FF3B30' },
  buttonText: { color: '#fff', fontWeight: '700' },
  hint: { textAlign: 'center', color: '#666', padding: 8, fontSize: 12 },
  error: { color: '#e00', textAlign: 'center', paddingHorizontal: 12 },
});
