import { NativeModules, Platform, NativeEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ComponentPowerMetrics {
  timestamp: number;
  cpu: {
    watts: number;
    percentage: number;
    frequency: number;
    efficiency_cores?: {
      count: number;
      usage: number;
      watts: number;
    };
    performance_cores?: {
      count: number;
      usage: number;
      watts: number;
    };
  };
  gpu: {
    watts: number;
    percentage: number;
    frequency?: number;
  };
  memory: {
    watts: number;
    bandwidth: number; // GB/s
    usage: number; // MB
  };
  display: {
    watts: number;
    brightness: number; // 0-1
  };
  neural_engine?: {
    watts: number;
    percentage: number;
  };
  system: {
    total_watts: number;
    battery_drain_ma: number;
    voltage: number;
  };
}

export interface EnergyMetrics {
  sessionId: string;
  startTime: number;
  endTime?: number;
  totalEnergy: number; // Joules
  energyByComponent: {
    cpu: number;
    gpu: number;
    memory: number;
    display: number;
    neural_engine?: number;
    other: number;
  };
  energyPerToken?: number; // Joules per token
  energyPerInference?: number; // Joules per inference
  peakPower: number; // Watts
  avgPower: number; // Watts
  efficiency: number; // Tokens per Joule
}

export interface PowerProfile {
  deviceModel: string;
  baselinePower: ComponentPowerMetrics;
  inferenceProfile: {
    avgCpuIncrease: number;
    avgGpuIncrease: number;
    avgMemoryIncrease: number;
    avgNeuralEngineIncrease?: number;
  };
  thermalProfile: {
    temperatureVsPower: { temp: number; power: number }[];
    throttleThreshold: number;
  };
}

// Native module interface (will be implemented in Swift/Kotlin)
interface NativePowerModule {
  startMonitoring(): Promise<void>;
  stopMonitoring(): Promise<void>;
  getCurrentPowerMetrics(): Promise<ComponentPowerMetrics>;
  getBatteryInfo(): Promise<{
    level: number;
    isCharging: boolean;
    voltage: number;
    current: number;
    capacity: number;
  }>;
  getCPUFrequencies(): Promise<{
    efficiency: number[];
    performance: number[];
  }>;
  getThermalState(): Promise<{
    state: 'nominal' | 'fair' | 'serious' | 'critical';
    temperature: number;
  }>;
}

export class PowerMeasurementService {
  private static instance: PowerMeasurementService;
  private nativeModule: NativePowerModule | null = null;
  private emitter: NativeEventEmitter | null = null;
  private isMonitoring: boolean = false;
  private metricsBuffer: ComponentPowerMetrics[] = [];
  private currentSession: EnergyMetrics | null = null;
  private powerProfile: PowerProfile | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private listeners: Map<string, (metrics: ComponentPowerMetrics) => void> = new Map();

  private constructor() {
    this.initializeNativeModule();
  }

  static getInstance(): PowerMeasurementService {
    if (!PowerMeasurementService.instance) {
      PowerMeasurementService.instance = new PowerMeasurementService();
    }
    return PowerMeasurementService.instance;
  }

  private initializeNativeModule() {
    try {
      // Try to load native module (will be null if not implemented yet)
      if (Platform.OS === 'ios' && NativeModules.PowerMetricsIOS) {
        this.nativeModule = NativeModules.PowerMetricsIOS;
        this.emitter = new NativeEventEmitter(NativeModules.PowerMetricsIOS);
      } else if (Platform.OS === 'android' && NativeModules.PowerMetricsAndroid) {
        this.nativeModule = NativeModules.PowerMetricsAndroid;
        this.emitter = new NativeEventEmitter(NativeModules.PowerMetricsAndroid);
      }

      if (this.emitter) {
        this.emitter.addListener('PowerMetricsUpdate', (metrics) => {
          this.handleMetricsUpdate(metrics);
        });
      }
    } catch (error) {
      console.log('Native power module not available, using estimation');
    }

    // Load or create power profile
    this.loadPowerProfile();
  }

  async startSession(sessionId: string): Promise<void> {
    this.currentSession = {
      sessionId,
      startTime: Date.now(),
      totalEnergy: 0,
      energyByComponent: {
        cpu: 0,
        gpu: 0,
        memory: 0,
        display: 0,
        neural_engine: 0,
        other: 0,
      },
      peakPower: 0,
      avgPower: 0,
      efficiency: 0,
    };

    this.metricsBuffer = [];
    await this.startMonitoring();
  }

  async endSession(): Promise<EnergyMetrics | null> {
    if (!this.currentSession) return null;

    await this.stopMonitoring();
    
    this.currentSession.endTime = Date.now();
    this.calculateSessionMetrics();
    
    const session = this.currentSession;
    this.currentSession = null;
    
    // Save session data
    await this.saveSession(session);
    
    return session;
  }

  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) return;

    this.isMonitoring = true;

    if (this.nativeModule) {
      // Use native monitoring
      await this.nativeModule.startMonitoring();
    } else {
      // Use estimation-based monitoring
      this.updateInterval = setInterval(async () => {
        const metrics = await this.estimatePowerMetrics();
        this.handleMetricsUpdate(metrics);
      }, 100); // 100ms sampling rate
    }
  }

  async stopMonitoring(): Promise<void> {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;

    if (this.nativeModule) {
      await this.nativeModule.stopMonitoring();
    } else if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private handleMetricsUpdate(metrics: ComponentPowerMetrics) {
    this.metricsBuffer.push(metrics);
    
    // Keep buffer size manageable (last 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    this.metricsBuffer = this.metricsBuffer.filter(m => m.timestamp > fiveMinutesAgo);

    // Update current session energy
    if (this.currentSession && this.metricsBuffer.length > 1) {
      const lastMetric = this.metricsBuffer[this.metricsBuffer.length - 2];
      const deltaTime = (metrics.timestamp - lastMetric.timestamp) / 1000; // seconds
      
      // Calculate energy for this interval (Power * Time)
      this.currentSession.totalEnergy += metrics.system.total_watts * deltaTime;
      this.currentSession.energyByComponent.cpu += metrics.cpu.watts * deltaTime;
      this.currentSession.energyByComponent.gpu += metrics.gpu.watts * deltaTime;
      this.currentSession.energyByComponent.memory += metrics.memory.watts * deltaTime;
      this.currentSession.energyByComponent.display += metrics.display.watts * deltaTime;
      
      if (metrics.neural_engine) {
        this.currentSession.energyByComponent.neural_engine! += metrics.neural_engine.watts * deltaTime;
      }

      // Update peak power
      if (metrics.system.total_watts > this.currentSession.peakPower) {
        this.currentSession.peakPower = metrics.system.total_watts;
      }
    }

    // Notify listeners
    this.listeners.forEach(listener => listener(metrics));
  }

  private async estimatePowerMetrics(): Promise<ComponentPowerMetrics> {
    // Estimation based on system activity and device profile
    // This is a fallback when native modules aren't available
    
    const SystemMonitorService = require('./SystemMonitorService').SystemMonitorService;
    const systemMonitor = SystemMonitorService.getInstance();
    const metrics = await systemMonitor.collectMetrics();

    const cpuUsage = metrics.cpuUsage || 0;
    const memoryUsage = metrics.memoryUsed || 0;
    const gpuUsage = 0; // GPU usage not available in current metrics

    // Load device-specific power coefficients
    const coefficients = this.getDevicePowerCoefficients();

    const cpuWatts = coefficients.cpu.idle + (cpuUsage / 100) * coefficients.cpu.active;
    const gpuWatts = coefficients.gpu.idle + (gpuUsage / 100) * coefficients.gpu.active;
    const memoryWatts = coefficients.memory.base + (memoryUsage / 1000) * coefficients.memory.per_gb;
    const displayWatts = coefficients.display.base; // Would need brightness API

    return {
      timestamp: Date.now(),
      cpu: {
        watts: cpuWatts,
        percentage: cpuUsage,
        frequency: 0, // Would need native API
      },
      gpu: {
        watts: gpuWatts,
        percentage: gpuUsage,
      },
      memory: {
        watts: memoryWatts,
        bandwidth: 0, // Would need native API
        usage: memoryUsage,
      },
      display: {
        watts: displayWatts,
        brightness: 0.5, // Default assumption
      },
      system: {
        total_watts: cpuWatts + gpuWatts + memoryWatts + displayWatts,
        battery_drain_ma: 0, // Would need battery API
        voltage: 3.8, // Typical smartphone battery voltage
      },
    };
  }

  private getDevicePowerCoefficients(): any {
    // Device-specific power coefficients (would be loaded from profile)
    const deviceModel = Platform.OS === 'ios' ? 'iPhone' : 'Android';
    
    // These are example coefficients - real values would come from profiling
    const coefficients: any = {
      iPhone: {
        cpu: { idle: 0.5, active: 4.0 },
        gpu: { idle: 0.2, active: 3.0 },
        memory: { base: 0.3, per_gb: 0.2 },
        display: { base: 1.0 },
      },
      Android: {
        cpu: { idle: 0.6, active: 4.5 },
        gpu: { idle: 0.3, active: 3.5 },
        memory: { base: 0.4, per_gb: 0.25 },
        display: { base: 1.2 },
      },
    };

    return coefficients[deviceModel] || coefficients.Android;
  }

  private calculateSessionMetrics() {
    if (!this.currentSession || this.metricsBuffer.length === 0) return;

    const duration = (this.currentSession.endTime! - this.currentSession.startTime) / 1000; // seconds
    
    // Calculate average power
    this.currentSession.avgPower = this.currentSession.totalEnergy / duration;

    // Calculate other component energy
    const componentTotal = Object.values(this.currentSession.energyByComponent)
      .reduce((sum, val) => sum + (val || 0), 0);
    this.currentSession.energyByComponent.other = 
      Math.max(0, this.currentSession.totalEnergy - componentTotal);
  }

  async calculateEnergyPerToken(tokenCount: number): Promise<number> {
    if (!this.currentSession || tokenCount === 0) return 0;
    return this.currentSession.totalEnergy / tokenCount;
  }

  async getCurrentMetrics(): Promise<ComponentPowerMetrics | null> {
    if (this.nativeModule) {
      return await this.nativeModule.getCurrentPowerMetrics();
    } else {
      return await this.estimatePowerMetrics();
    }
  }

  getBufferedMetrics(duration?: number): ComponentPowerMetrics[] {
    if (!duration) return this.metricsBuffer;
    
    const cutoff = Date.now() - duration;
    return this.metricsBuffer.filter(m => m.timestamp > cutoff);
  }

  subscribeToMetrics(id: string, callback: (metrics: ComponentPowerMetrics) => void): void {
    this.listeners.set(id, callback);
  }

  unsubscribeFromMetrics(id: string): void {
    this.listeners.delete(id);
  }

  // Power profile management
  private async loadPowerProfile(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem('power_profile');
      if (stored) {
        this.powerProfile = JSON.parse(stored);
      } else {
        await this.createPowerProfile();
      }
    } catch (error) {
      console.error('Error loading power profile:', error);
      await this.createPowerProfile();
    }
  }

  private async createPowerProfile(): Promise<void> {
    // Create a baseline power profile for the device
    const baseline = await this.measureBaselinePower();
    
    this.powerProfile = {
      deviceModel: Platform.OS === 'ios' ? 'iPhone' : 'Android',
      baselinePower: baseline,
      inferenceProfile: {
        avgCpuIncrease: 3.0, // Will be calibrated
        avgGpuIncrease: 2.5,
        avgMemoryIncrease: 0.5,
        avgNeuralEngineIncrease: 2.0,
      },
      thermalProfile: {
        temperatureVsPower: [],
        throttleThreshold: 45, // Celsius
      },
    };

    await this.savePowerProfile();
  }

  private async measureBaselinePower(): Promise<ComponentPowerMetrics> {
    // Measure baseline power consumption (idle state)
    const samples: ComponentPowerMetrics[] = [];
    
    for (let i = 0; i < 10; i++) {
      const metrics = await this.getCurrentMetrics();
      if (metrics) samples.push(metrics);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (samples.length === 0) {
      // Return default baseline
      return await this.estimatePowerMetrics();
    }

    // Average the samples
    const avgMetrics = samples.reduce((acc, sample) => {
      acc.cpu.watts += sample.cpu.watts;
      acc.gpu.watts += sample.gpu.watts;
      acc.memory.watts += sample.memory.watts;
      acc.display.watts += sample.display.watts;
      acc.system.total_watts += sample.system.total_watts;
      return acc;
    }, {
      timestamp: Date.now(),
      cpu: { watts: 0, percentage: 0, frequency: 0 },
      gpu: { watts: 0, percentage: 0 },
      memory: { watts: 0, bandwidth: 0, usage: 0 },
      display: { watts: 0, brightness: 0 },
      system: { total_watts: 0, battery_drain_ma: 0, voltage: 3.8 },
    } as ComponentPowerMetrics);

    // Calculate averages
    const count = samples.length;
    avgMetrics.cpu.watts /= count;
    avgMetrics.gpu.watts /= count;
    avgMetrics.memory.watts /= count;
    avgMetrics.display.watts /= count;
    avgMetrics.system.total_watts /= count;

    return avgMetrics;
  }

  async calibrateInferenceProfile(
    tokenCount: number,
    inferenceTime: number,
    measuredEnergy: number
  ): Promise<void> {
    if (!this.powerProfile) return;

    // Update inference profile based on measured data
    const energyPerToken = measuredEnergy / tokenCount;
    const avgPower = measuredEnergy / (inferenceTime / 1000);
    
    // Update profile with exponential moving average
    const alpha = 0.3; // Learning rate
    const baselinePower = this.powerProfile.baselinePower.system.total_watts;
    const powerIncrease = avgPower - baselinePower;
    
    if (powerIncrease > 0) {
      // Estimate component contributions (simplified)
      this.powerProfile.inferenceProfile.avgCpuIncrease = 
        (1 - alpha) * this.powerProfile.inferenceProfile.avgCpuIncrease +
        alpha * (powerIncrease * 0.5); // Assume 50% CPU
      
      this.powerProfile.inferenceProfile.avgGpuIncrease =
        (1 - alpha) * this.powerProfile.inferenceProfile.avgGpuIncrease +
        alpha * (powerIncrease * 0.3); // Assume 30% GPU
      
      this.powerProfile.inferenceProfile.avgMemoryIncrease =
        (1 - alpha) * this.powerProfile.inferenceProfile.avgMemoryIncrease +
        alpha * (powerIncrease * 0.2); // Assume 20% Memory
    }

    await this.savePowerProfile();
  }

  private async savePowerProfile(): Promise<void> {
    if (this.powerProfile) {
      await AsyncStorage.setItem('power_profile', JSON.stringify(this.powerProfile));
    }
  }

  private async saveSession(session: EnergyMetrics): Promise<void> {
    const key = `energy_session_${session.sessionId}`;
    await AsyncStorage.setItem(key, JSON.stringify(session));
  }

  async loadSession(sessionId: string): Promise<EnergyMetrics | null> {
    try {
      const key = `energy_session_${sessionId}`;
      const data = await AsyncStorage.getItem(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading energy session:', error);
    }
    return null;
  }

  // Analysis methods
  async analyzePowerEfficiency(
    sessionId: string,
    tokenCount: number
  ): Promise<{
    energyPerToken: number;
    tokensPerJoule: number;
    efficiencyRating: 'excellent' | 'good' | 'fair' | 'poor';
    componentBreakdown: { [key: string]: number };
  }> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const energyPerToken = session.totalEnergy / tokenCount;
    const tokensPerJoule = tokenCount / session.totalEnergy;

    // Determine efficiency rating
    let efficiencyRating: 'excellent' | 'good' | 'fair' | 'poor';
    if (tokensPerJoule > 10) {
      efficiencyRating = 'excellent';
    } else if (tokensPerJoule > 5) {
      efficiencyRating = 'good';
    } else if (tokensPerJoule > 2) {
      efficiencyRating = 'fair';
    } else {
      efficiencyRating = 'poor';
    }

    // Calculate component breakdown percentages
    const componentBreakdown: { [key: string]: number } = {};
    const total = session.totalEnergy;
    
    for (const [component, energy] of Object.entries(session.energyByComponent)) {
      if (energy && energy > 0) {
        componentBreakdown[component] = (energy / total) * 100;
      }
    }

    return {
      energyPerToken,
      tokensPerJoule,
      efficiencyRating,
      componentBreakdown,
    };
  }

  getPowerProfile(): PowerProfile | null {
    return this.powerProfile;
  }
}