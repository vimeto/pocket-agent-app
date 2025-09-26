import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Model } from '../types';
import { DEFAULT_MODELS } from '../config/models';
import { AuthService } from './AuthService';

const MODELS_STORAGE_KEY = 'llm_models';
const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models`;

export class ModelService {
  private static instance: ModelService;
  private authService: AuthService;

  private constructor() {
    this.ensureModelsDirectory();
    this.authService = AuthService.getInstance();
  }

  static getInstance(): ModelService {
    if (!ModelService.instance) {
      ModelService.instance = new ModelService();
    }
    return ModelService.instance;
  }

  private async ensureModelsDirectory(): Promise<void> {
    const exists = await RNFS.exists(MODELS_DIR);
    if (!exists) {
      await RNFS.mkdir(MODELS_DIR);
    }
  }

  async getAvailableModels(): Promise<Model[]> {
    try {
      const storedModels = await AsyncStorage.getItem(MODELS_STORAGE_KEY);
      if (storedModels) {
        const models = JSON.parse(storedModels);
        
        // Check if we have old models or if the model list needs updating
        const hasOldModels = models.some((m: Model) => 
          m.id === 'tinyllama-1.1b-chat' || 
          m.id === 'phi-2' || 
          m.id === 'llama-2-7b-chat' ||
          m.id === 'gemma-2b' // Old gemma model ID
        );
        
        // Also check if we're missing new models
        const modelIds = models.map((m: Model) => m.id);
        const hasMissingModels = DEFAULT_MODELS.some(dm => !modelIds.includes(dm.id));
        
        // Force update if old models detected or new models are missing
        if (hasOldModels || hasMissingModels) {
          // Preserve download status for existing models
          const updatedModels = DEFAULT_MODELS.map(defaultModel => {
            const existingModel = models.find((m: Model) => m.id === defaultModel.id);
            if (existingModel && existingModel.downloaded) {
              return { ...defaultModel, downloaded: true, path: existingModel.path };
            }
            return defaultModel;
          });
          
          await this.saveModels(updatedModels);
          return updatedModels;
        }
        
        return models;
      }
      await this.saveModels(DEFAULT_MODELS);
      return DEFAULT_MODELS;
    } catch (error) {
      console.error('Error loading models:', error);
      return DEFAULT_MODELS;
    }
  }

  async saveModels(models: Model[]): Promise<void> {
    await AsyncStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
  }

  async forceRefreshModels(): Promise<Model[]> {
    // Clear the cache and reload from defaults
    await AsyncStorage.removeItem(MODELS_STORAGE_KEY);
    return this.getAvailableModels();
  }

  async downloadModel(
    model: Model,
    onProgress?: (bytesWritten: number, contentLength: number, speed: number) => void,
    onLog?: (level: 'info' | 'warning' | 'error', message: string, details?: any) => void
  ): Promise<string> {
    if (!model.url) {
      throw new Error('Model URL not provided');
    }

    const fileName = `${model.id}.gguf`;
    const filePath = `${MODELS_DIR}/${fileName}`;

    onLog?.('info', `Starting download from ${model.url}`, { fileName, filePath });

    // Get auth headers if needed
    let headers: Record<string, string> = {};
    if (model.requiresAuth) {
      headers = await this.authService.getAuthHeaders();
      if (!headers.Authorization) {
        throw new Error('Authentication required. Please add your Hugging Face token.');
      }
      onLog?.('info', 'Using authenticated request');
    }

    let lastProgressTime = Date.now();
    let lastBytesWritten = 0;

    const downloadOptions = {
      fromUrl: model.url,
      toFile: filePath,
      headers,
      progress: (res: any) => {
        const currentTime = Date.now();
        const timeDiff = (currentTime - lastProgressTime) / 1000; // seconds
        const bytesDiff = res.bytesWritten - lastBytesWritten;
        const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

        onProgress?.(res.bytesWritten, res.contentLength, speed);
        
        lastProgressTime = currentTime;
        lastBytesWritten = res.bytesWritten;
      },
      progressDivider: 10,
      connectionTimeout: 30000,
      readTimeout: 30000,
    };

    try {
      const downloadTask = RNFS.downloadFile(downloadOptions);
      
      const result = await downloadTask.promise;
      
      if (result.statusCode !== 200) {
        onLog?.('error', `HTTP error: ${result.statusCode}`, { statusCode: result.statusCode });
        throw new Error(`Failed to download model: HTTP ${result.statusCode}`);
      }

      onLog?.('info', 'Download completed successfully', { 
        bytesWritten: result.bytesWritten,
        statusCode: result.statusCode 
      });

      const models = await this.getAvailableModels();
      const updatedModels = models.map(m => 
        m.id === model.id 
          ? { ...m, downloaded: true, path: filePath }
          : m
      );
      await this.saveModels(updatedModels);

      return filePath;
    } catch (error: any) {
      onLog?.('error', 'Download failed', { error: error.message });
      
      // Clean up partial download
      const exists = await RNFS.exists(filePath);
      if (exists) {
        await RNFS.unlink(filePath);
        onLog?.('info', 'Cleaned up partial download');
      }
      
      throw error;
    }
  }

  async deleteModel(modelId: string): Promise<void> {
    const models = await this.getAvailableModels();
    const model = models.find(m => m.id === modelId);
    
    if (model?.path && await RNFS.exists(model.path)) {
      await RNFS.unlink(model.path);
    }

    const updatedModels = models.map(m =>
      m.id === modelId
        ? { ...m, downloaded: false, path: undefined, progress: undefined }
        : m
    );
    await this.saveModels(updatedModels);
  }

  async getModelPath(modelId: string): Promise<string | null> {
    const models = await this.getAvailableModels();
    const model = models.find(m => m.id === modelId);

    if (!model?.downloaded) {
      return null;
    }

    // If model has a path but it's an absolute path from a previous installation,
    // reconstruct it with the current document directory
    if (model.path) {
      const fileName = model.path.split('/').pop();
      const currentPath = `${MODELS_DIR}/${fileName}`;

      // Check if file exists at the expected location
      const exists = await RNFS.exists(currentPath);
      if (exists) {
        // Update the model with the correct path if it changed
        if (model.path !== currentPath) {
          const updatedModels = models.map(m =>
            m.id === modelId ? { ...m, path: currentPath } : m
          );
          await this.saveModels(updatedModels);
        }
        return currentPath;
      }
    }

    // Fallback: try default filename
    const defaultPath = `${MODELS_DIR}/${modelId}.gguf`;
    const exists = await RNFS.exists(defaultPath);
    if (exists) {
      // Update the model with the correct path
      const updatedModels = models.map(m =>
        m.id === modelId ? { ...m, path: defaultPath } : m
      );
      await this.saveModels(updatedModels);
      return defaultPath;
    }

    return null;
  }

  async getDownloadedModels(): Promise<string[]> {
    const models = await this.getAvailableModels();
    return models
      .filter(m => m.downloaded)
      .map(m => m.id);
  }
}