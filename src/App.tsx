import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { X, RotateCcw } from 'lucide-react'; // Add RotateCcw import

const API_ENDPOINT = "https://api-widget-oa.widgetplatform.com";

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
  // Function declarations first
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // State declarations
  const [messages, setMessages] = useState<Message[]>(() => {
    const savedMessages = localStorage.getItem(STORAGE_KEYS.MESSAGES);
    return savedMessages ? JSON.parse(savedMessages) : [];
  });
  const [settings, setSettings] = useState<WidgetSettings>({ welcome_text: '', title: '', show_poweredby: true, input_placeholder: 'Type your message...', loading_api: 'Thinking', loading_openai: 'Thinking', tooltip_reset: 'Reset chat', tooltip_close: 'Close chat', loading_app: 'Loading chat...' });
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [threadId, setThreadId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEYS.THREAD_ID);
  });
  const [isLoading, setIsLoading] = useState(true);
  const [id, setId] = useState<string | null>(null);

  // Effects
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const widgetId = params.get('id');
        
        if(widgetId) {
          setId(widgetId);

          const response = await fetch(`${API_ENDPOINT}/settings?id=${widgetId}`);

          let loadedSettings: WidgetSettings;
          if (response.ok) {
            loadedSettings = await response.json();
          } else {
            throw new Error('Failed to load settings');
          }
          setSettings(loadedSettings);
        }

      } catch (error) {
        setSettings({
          welcome_text: '',
          title: '',
          show_poweredby: true,
          input_placeholder: 'Type your message...',
          loading_api: 'Thinking',
          loading_openai: 'Thinking',
          tooltip_reset: 'Reset chat',
          tooltip_close: 'Close chat',
          loading_app: 'Loading chat...'
        });
      } finally {
        setIsLoading(false);
        setTimeout(scrollToBottom, 500);
      }
    };

    loadSettings();
  }, []);

  useEffect(() => {
    setTimeout(scrollToBottom, 100);
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
  }, [messages]);

  // Conditional rendering
  if (isLoading) {
    return (
      <div className="flex flex-col h-screen bg-white items-center justify-center">
        <div className="mt-4 text-gray-600">{settings.loading_app || 'Loading chat...'}</div>
      </div>
    );
  }

  const handleSend = async (content: string) => {
    const userMessage: Message = { role: 'user', content };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add thread ID to headers if it exists
      if (threadId) {
        headers['x-thread-id'] = threadId;
      }

      // Get id from URL parameters
      const params = new URLSearchParams(window.location.search);
      const widgetId = params.get('id') || null;


      // Add the assistant message initially
      setMessages(prev => [...prev, { role: 'assistant' as const, content: settings.loading_api || 'Thinking' }]);

      const response = await fetch(`${API_ENDPOINT}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: content,
          widgetId,
          settings
        }),
      });

      const reader = response.body?.getReader();
      let assistantMessage = '';

      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          role: 'assistant' as const,
          content: settings.loading_openai || 'Thinking'
        };
        return newMessages;
      });

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        // Convert the chunk to text
        const text = new TextDecoder().decode(value);

        // Split the text into SSE messages
        const messages = text.split('\n\n');

        for (const message of messages) {
          if (message.startsWith('data: ')) {
            const data = message.slice(6); // Remove 'data: ' prefix

            if (data === '[DONE]') {
              break;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                // Append new content to existing message
                assistantMessage += parsed.content;

                // Update the messages array with the accumulated content
                setMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    role: 'assistant',
                    content: assistantMessage
                  };
                  return newMessages;
                });
              }
              else if (parsed.info) {
                // Store thread ID in both state and localStorage
                setThreadId(parsed.info.id);
                localStorage.setItem(STORAGE_KEYS.THREAD_ID, parsed.info.id);
              }
            } catch (e) {
              console.error('Error parsing SSE message:', e);
            }
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
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h1 className="text-xl font-semibold">{settings.title}</h1>
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

      <ChatInput onSend={handleSend} disabled={isStreaming} settings={{ input_placeholder: settings.input_placeholder }} />
      {settings.show_poweredby && <a href="https://widgetplatform.com" target="_blank" className="pb-2 bg-white text-center text-xs text-gray-500">
        Powered by Widget Platform
      </a>}

    </div>
  );
}

export default App;