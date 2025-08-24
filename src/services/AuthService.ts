import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

const HF_TOKEN_KEY = 'hf_api_token';
const KEYCHAIN_SERVICE = 'PocketAgent_HuggingFace';

export class AuthService {
  private static instance: AuthService;

  private constructor() {}

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Store Hugging Face API token securely
   */
  async saveHuggingFaceToken(token: string): Promise<void> {
    try {
      // Try to use Keychain for secure storage on iOS/Android
      await Keychain.setInternetCredentials(
        KEYCHAIN_SERVICE,
        'huggingface',
        'api_token',
        token
      );
    } catch (error) {
      // Fallback to AsyncStorage if Keychain is not available
      console.warn('Keychain not available, using AsyncStorage', error);
      await AsyncStorage.setItem(HF_TOKEN_KEY, token);
    }
  }

  /**
   * Retrieve Hugging Face API token
   */
  async getHuggingFaceToken(): Promise<string | null> {
    try {
      // Try to get from Keychain first
      const credentials = await Keychain.getInternetCredentials(KEYCHAIN_SERVICE);
      if (credentials) {
        return credentials.password;
      }
    } catch (error) {
      // Fallback to AsyncStorage
      const token = await AsyncStorage.getItem(HF_TOKEN_KEY);
      if (token) {
        return token;
      }
    }
    return null;
  }

  /**
   * Remove Hugging Face API token
   */
  async removeHuggingFaceToken(): Promise<void> {
    try {
      await Keychain.resetInternetCredentials(KEYCHAIN_SERVICE);
    } catch (error) {
      // Fallback to AsyncStorage
      await AsyncStorage.removeItem(HF_TOKEN_KEY);
    }
  }

  /**
   * Validate token by making a test API call
   */
  async validateToken(token: string): Promise<boolean> {
    try {
      const response = await fetch('https://huggingface.co/api/whoami', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get authenticated headers for Hugging Face requests
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getHuggingFaceToken();
    if (!token) {
      return {};
    }
    return {
      'Authorization': `Bearer ${token}`,
    };
  }
}