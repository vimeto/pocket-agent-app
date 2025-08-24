import { create } from 'zustand';
import { ChatSession, Message, Model, InferenceConfig } from '../types';
import { DownloadState, DownloadStatus } from '../types/download';
import { DEFAULT_INFERENCE_CONFIG } from '../config/models';
import { PerformanceMetrics } from '../services/PerformanceService';
import { SystemMetrics } from '../services/SystemMonitorService';

interface AppState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  models: Model[];
  selectedModelId: string | null;
  inferenceConfig: InferenceConfig;
  isGenerating: boolean;
  downloads: Record<string, DownloadState>;
  hasHuggingFaceToken: boolean;
  
  // Performance tracking
  performanceMetrics: Record<string, PerformanceMetrics>;
  currentSystemMetrics: SystemMetrics | null;
  showPerformanceOverlay: boolean;
  appMode: 'chat' | 'benchmark';

  createSession: (modelId: string) => ChatSession;
  deleteSession: (sessionId: string) => void;
  setCurrentSession: (sessionId: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  updateModels: (models: Model[]) => void;
  setSelectedModel: (modelId: string) => void;
  updateInferenceConfig: (config: Partial<InferenceConfig>) => void;
  setGenerating: (isGenerating: boolean) => void;
  
  // Download management
  initDownload: (modelId: string) => void;
  updateDownload: (modelId: string, updates: Partial<DownloadState>) => void;
  addDownloadLog: (modelId: string, level: 'info' | 'warning' | 'error', message: string, details?: any) => void;
  clearDownload: (modelId: string) => void;
  
  // Auth management
  setHasHuggingFaceToken: (hasToken: boolean) => void;
  
  // Performance management
  updatePerformanceMetrics: (messageId: string, metrics: PerformanceMetrics) => void;
  updateSystemMetrics: (metrics: SystemMetrics) => void;
  togglePerformanceOverlay: () => void;
  setAppMode: (mode: 'chat' | 'benchmark') => void;
}

export const useStore = create<AppState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  models: [],
  selectedModelId: null,
  inferenceConfig: DEFAULT_INFERENCE_CONFIG,
  isGenerating: false,
  downloads: {},
  hasHuggingFaceToken: false,
  
  // Performance tracking
  performanceMetrics: {},
  currentSystemMetrics: null,
  showPerformanceOverlay: false,
  appMode: 'chat',

  createSession: (modelId: string) => {
    const session: ChatSession = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: [],
      modelId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    set((state) => ({
      sessions: [...state.sessions, session],
      currentSessionId: session.id,
    }));

    return session;
  },

  deleteSession: (sessionId: string) => {
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      currentSessionId:
        state.currentSessionId === sessionId ? null : state.currentSessionId,
    }));
  },

  setCurrentSession: (sessionId: string) => {
    set({ currentSessionId: sessionId });
  },

  addMessage: (sessionId: string, message: Message) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: [...session.messages, message],
              updatedAt: new Date(),
              title:
                session.messages.length === 0 && message.sender === 'user'
                  ? message.text.slice(0, 50) + '...'
                  : session.title,
            }
          : session
      ),
    }));
  },

  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => {
    set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                messages: session.messages.map((msg) =>
                  msg.id === messageId ? { ...msg, ...updates } : msg
                ),
                updatedAt: new Date(),
              }
            : session
        ),
    }));
  },

  updateModels: (models: Model[]) => {
    set({ models });
  },

  setSelectedModel: (modelId: string) => {
    set({ selectedModelId: modelId });
  },

  updateInferenceConfig: (config: Partial<InferenceConfig>) => {
    set((state) => ({
      inferenceConfig: { ...state.inferenceConfig, ...config },
    }));
  },

  setGenerating: (isGenerating: boolean) => {
    set({ isGenerating });
  },

  initDownload: (modelId: string) => {
    set((state) => ({
      downloads: {
        ...state.downloads,
        [modelId]: {
          modelId,
          status: DownloadStatus.DOWNLOADING,
          progress: 0,
          bytesDownloaded: 0,
          totalBytes: 0,
          speed: 0,
          logs: [{
            timestamp: new Date(),
            level: 'info',
            message: 'Download started',
          }],
          startTime: new Date(),
          retryCount: 0,
        },
      },
    }));
  },

  updateDownload: (modelId: string, updates: Partial<DownloadState>) => {
    set((state) => ({
      downloads: {
        ...state.downloads,
        [modelId]: {
          ...state.downloads[modelId],
          ...updates,
        },
      },
    }));
  },

  addDownloadLog: (modelId: string, level: 'info' | 'warning' | 'error', message: string, details?: any) => {
    set((state) => {
      const download = state.downloads[modelId];
      if (!download) return state;

      return {
        downloads: {
          ...state.downloads,
          [modelId]: {
            ...download,
            logs: [...download.logs, {
              timestamp: new Date(),
              level,
              message,
              details,
            }],
          },
        },
      };
    });
  },

  clearDownload: (modelId: string) => {
    set((state) => {
      const { [modelId]: _, ...rest } = state.downloads;
      return { downloads: rest };
    });
  },

  setHasHuggingFaceToken: (hasToken: boolean) => {
    set({ hasHuggingFaceToken: hasToken });
  },
  
  updatePerformanceMetrics: (messageId: string, metrics: PerformanceMetrics) => {
    set((state) => ({
      performanceMetrics: {
        ...state.performanceMetrics,
        [messageId]: metrics,
      },
    }));
  },
  
  updateSystemMetrics: (metrics: SystemMetrics) => {
    set({ currentSystemMetrics: metrics });
  },
  
  togglePerformanceOverlay: () => {
    set((state) => ({ showPerformanceOverlay: !state.showPerformanceOverlay }));
  },
  
  setAppMode: (mode: 'chat' | 'benchmark') => {
    set({ appMode: mode });
  },
}));