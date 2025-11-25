import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { X, RotateCcw } from 'lucide-react';
import { API_ENDPOINT } from './config';

const WELCOME_ASSISTANT_MSG = 'Напишите мне — я подскажу по любому вопросу';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface WidgetSettings {
  welcome_text: string;
  title: string;
  show_poweredby?: boolean;
  input_placeholder?: string;
  loading_api?: string;
  loading_openai?: string;
  tooltip_reset?: string;
  tooltip_close?: string;
  loading_app?: string;
}

const STORAGE_KEYS = {
  THREAD_ID: 'chatThreadId',
  MESSAGES: 'chatMessages'
} as const;

function App() {
  // helpers
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // state
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MESSAGES);
    return saved ? JSON.parse(saved) : [];
  });
  const [settings, setSettings] = useState<WidgetSettings>({
    welcome_text: '',
    title: '',
    show_poweredby: true,
    input_placeholder: 'Введите ваш вопрос...',
    loading_api: 'Печатаю...',
    loading_openai: 'Печатаю...',
    tooltip_reset: 'Перезапустить чат',
    tooltip_close: 'Закрыть чат',
    loading_app: 'Загрузка чата...'
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [threadId, setThreadId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEYS.THREAD_ID);
  });
  const [isLoading, setIsLoading] = useState(true);
  const [id, setId] = useState<string | null>(null);

  // чтобы не вставлять приветствие повторно
  const greetedRef = useRef(false);

  // effects
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const widgetId = params.get('id');

        if (widgetId) {
          setId(widgetId);
          const response = await fetch(`${API_ENDPOINT}/settings?id=${widgetId}`);
          if (!response.ok) throw new Error('Failed to load settings');
          const loadedSettings: WidgetSettings = await response.json();
          setSettings(loadedSettings);
        }
      } catch {
        setSettings({
          welcome_text: '',
          title: '',
          show_poweredby: true,
          input_placeholder: 'Введите ваш вопрос...',
          loading_api: 'Печатаю...',
          loading_openai: 'Печатаю...',
          tooltip_reset: 'Перезапустить чат',
          tooltip_close: 'Закрыть чат',
          loading_app: 'Загрузка чата...'
        });
      } finally {
        setIsLoading(false);
        setTimeout(scrollToBottom, 500);
      }
    };

    loadSettings();
  }, []);

  // добавляем одноразовое приветственное сообщение ассистента,
  // только если сообщений ещё нет (пустая лента)
  useEffect(() => {
    if (isLoading) return;
    if (greetedRef.current) return;
    if (messages.length > 0) {
      greetedRef.current = true;
      return;
    }
    setMessages(prev => {
      if (prev.length > 0) return prev;
      return [...prev, { role: 'assistant', content: WELCOME_ASSISTANT_MSG }];
    });
    greetedRef.current = true;
  }, [isLoading]); // запускаем после загрузки настроек

  useEffect(() => {
    setTimeout(scrollToBottom, 100);
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
  }, [messages]);

  // loading
  if (isLoading) {
    return (
      <div className="flex flex-col h-screen bg-white items-center justify-center">
        <div className="mt-4 text-gray-600">{settings.loading_app || 'Loading chat...'}</div>
      </div>
    );
  }

  // actions
  const handleSend = async (content: string) => {
    const userMessage: Message = { role: 'user', content };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (threadId) headers['x-thread-id'] = threadId;

      const params = new URLSearchParams(window.location.search);
      const widgetId = params.get('id') || null;

      // ставим «ассистент печатает...»
      setMessages(prev => [...prev, { role: 'assistant', content: settings.loading_api || 'Печатаю...' }]);

      const response = await fetch(`${API_ENDPOINT}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: content, widgetId, settings }),
      });

      const reader = response.body?.getReader();
      let assistantMessage = '';

      // меняем плейсхолдер «печатаю...» на реальный стрим
      setMessages(prev => {
        const list = [...prev];
        list[list.length - 1] = {
          role: 'assistant',
          content: settings.loading_openai || 'Печатаю...'
        };
        return list;
      });

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        const chunks = text.split('\n\n');

        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          const data = chunk.slice(6);

          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              assistantMessage += parsed.content;
              setMessages(prev => {
                const list = [...prev];
                list[list.length - 1] = { role: 'assistant', content: assistantMessage };
                return list;
              });
            } else if (parsed.info) {
              setThreadId(parsed.info.id);
              localStorage.setItem(STORAGE_KEYS.THREAD_ID, parsed.info.id);
            }
          } catch (e) {
            console.error('Error parsing SSE message:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClose = () => {
    window.parent.postMessage('close-chat', '*');
  };

  const handleReset = () => {
    setMessages([]);
    setThreadId(null);
    localStorage.removeItem(STORAGE_KEYS.THREAD_ID);
    localStorage.removeItem(STORAGE_KEYS.MESSAGES);
    greetedRef.current = false; // чтобы снова показать приветствие при пустой ленте
    // Переинициализируем приветствие сразу:
    setMessages([{ role: 'assistant', content: WELCOME_ASSISTANT_MSG }]);
    greetedRef.current = true;
  };

  // render
  return (
    <div className="flex flex-col h-screen bg-white">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div>
          {/* 1rem = text-base */}
          <p className="text-base text-gray-600">
            Вас приветствует ИИ чат бот
          </p>
          {settings.title && <h1 className="text-xl font-semibold">{settings.title}</h1>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-300 hover:text-gray-800 relative group"
            aria-label={settings.tooltip_reset}
          >
            <RotateCcw className="w-5 h-5" />
            <span className="z-10 absolute text-nowrap right-0 mt-3 opacity-0 group-hover:opacity-100 bg-gray-800 text-white text-xs py-1 px-2 rounded transition-opacity delay-500 pointer-events-none">
              {settings.tooltip_reset}
            </span>
          </button>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative group"
            aria-label={settings.tooltip_close}
          >
            <X className="w-5 h-5" />
            <span className="z-10 absolute text-nowrap right-0 mt-3 opacity-0 group-hover:opacity-100 bg-gray-800 text-white text-xs py-1 px-2 rounded transition-opacity delay-500 pointer-events-none">
              {settings.tooltip_close}
            </span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {settings.welcome_text && (
          <div className="text-center px-4 py-2 rounded-lg text-gray-600 mb-4">
            {settings.welcome_text}
          </div>
        )}

        {messages.map((message, index) => (
          <ChatMessage
            key={index}
            id={id}
            message={message}
            isStreaming={isStreaming && index === messages.length - 1}
            threadId={threadId}
            messageHistory={messages}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={handleSend}
        disabled={isStreaming}
        settings={{ input_placeholder: settings.input_placeholder }}
      />
    </div>
  );
}

export default App;
