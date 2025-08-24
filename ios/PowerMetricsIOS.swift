import Foundation
import UIKit

@objc(PowerMetricsIOS)
class PowerMetricsIOS: RCTEventEmitter {
    private var timer: Timer?
    private var isMonitoring = false
    private let thermalStateObserver = ThermalStateObserver()
    private let batteryMonitor = BatteryMonitor()
    
    override init() {
        super.init()
        setupNotifications()
    }
    
    deinit {
        stopMonitoring()
        removeNotifications()
    }
    
    override static func requiresMainQueueSetup() -> Bool {
        return false
    }
    
    override func supportedEvents() -> [String]! {
        return ["PowerMetricsUpdate", "ThermalStateChange", "BatteryStateChange"]
    }
    
    private func setupNotifications() {
        // Battery notifications
        UIDevice.current.isBatteryMonitoringEnabled = true
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(batteryLevelDidChange),
            name: UIDevice.batteryLevelDidChangeNotification,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(batteryStateDidChange),
            name: UIDevice.batteryStateDidChangeNotification,
            object: nil
        )
        
        // Thermal state notifications
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(thermalStateDidChange),
            name: ProcessInfo.thermalStateDidChangeNotification,
            object: nil
        )
    }
    
    private func removeNotifications() {
        NotificationCenter.default.removeObserver(self)
        UIDevice.current.isBatteryMonitoringEnabled = false
    }
    
    @objc
    func startMonitoring(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard !isMonitoring else {
            resolve(nil)
            return
        }
        
        isMonitoring = true
        
        // Start periodic monitoring at 100ms intervals
        DispatchQueue.main.async { [weak self] in
            self?.timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
                self?.collectAndSendMetrics()
            }
        }
        
        resolve(nil)
    }
    
    @objc
    func stopMonitoring(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        isMonitoring = false
        timer?.invalidate()
        timer = nil
        resolve(nil)
    }
    
    @objc
    func getCurrentPowerMetrics(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let metrics = collectCurrentMetrics()
        resolve(metrics)
    }
    
    @objc
    func getBatteryInfo(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let device = UIDevice.current
        let batteryInfo: [String: Any] = [
            "level": device.batteryLevel,
            "isCharging": device.batteryState == .charging || device.batteryState == .full,
            "voltage": estimateBatteryVoltage(),
            "current": estimateBatteryCurrent(),
            "capacity": estimateBatteryCapacity()
        ]
        resolve(batteryInfo)
    }
    
    @objc
    func getCPUFrequencies(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let frequencies = getCPUFrequencyInfo()
        resolve(frequencies)
    }
    
    @objc
    func getThermalState(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let thermalState = ProcessInfo.processInfo.thermalState
        let stateString: String
        let temperature = estimateTemperature(from: thermalState)
        
        switch thermalState {
        case .nominal:
            stateString = "nominal"
        case .fair:
            stateString = "fair"
        case .serious:
            stateString = "serious"
        case .critical:
            stateString = "critical"
        @unknown default:
            stateString = "unknown"
        }
        
        let result: [String: Any] = [
            "state": stateString,
            "temperature": temperature
        ]
        
        resolve(result)
    }
    
    private func collectAndSendMetrics() {
        let metrics = collectCurrentMetrics()
        sendEvent(withName: "PowerMetricsUpdate", body: metrics)
    }
    
    private func collectCurrentMetrics() -> [String: Any] {
        let timestamp = Date().timeIntervalSince1970 * 1000
        let cpuInfo = getCPUUsageInfo()
        let memoryInfo = getMemoryInfo()
        let thermalState = ProcessInfo.processInfo.thermalState
        let batteryLevel = UIDevice.current.batteryLevel
        let isCharging = UIDevice.current.batteryState == .charging || UIDevice.current.batteryState == .full
        
        // Estimate power consumption based on system state
        let cpuPower = estimateCPUPower(usage: cpuInfo["percentage"] as? Double ?? 0, thermalState: thermalState)
        let gpuPower = estimateGPUPower(thermalState: thermalState)
        let memoryPower = estimateMemoryPower(usage: memoryInfo["used"] as? Double ?? 0)
        let displayPower = estimateDisplayPower()
        let neuralPower = estimateNeuralEnginePower()
        
        let totalPower = cpuPower + gpuPower + memoryPower + displayPower + neuralPower
        
        return [
            "timestamp": timestamp,
            "cpu": [
                "watts": cpuPower,
                "percentage": cpuInfo["percentage"] ?? 0,
                "frequency": cpuInfo["frequency"] ?? 0,
                "efficiency_cores": cpuInfo["efficiency_cores"],
                "performance_cores": cpuInfo["performance_cores"]
            ],
            "gpu": [
                "watts": gpuPower,
                "percentage": estimateGPUUsage()
            ],
            "memory": [
                "watts": memoryPower,
                "bandwidth": memoryInfo["bandwidth"] ?? 0,
                "usage": memoryInfo["used"] ?? 0
            ],
            "display": [
                "watts": displayPower,
                "brightness": UIScreen.main.brightness
            ],
            "neural_engine": [
                "watts": neuralPower,
                "percentage": estimateNeuralEngineUsage()
            ],
            "system": [
                "total_watts": totalPower,
                "battery_drain_ma": estimateBatteryDrain(totalPower: totalPower, isCharging: isCharging),
                "voltage": estimateBatteryVoltage()
            ]
        ]
    }
    
    private func getCPUUsageInfo() -> [String: Any] {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_,
                         task_flavor_t(MACH_TASK_BASIC_INFO),
                         $0,
                         &count)
            }
        }
        
        var cpuUsage: Double = 0
        if result == KERN_SUCCESS {
            cpuUsage = Double(info.resident_size) / Double(1024 * 1024) // Convert to MB
        }
        
        // Get processor info
        let processorInfo = getProcessorInfo()
        
        return [
            "percentage": min(100, cpuUsage / 10), // Rough estimation
            "frequency": processorInfo["frequency"] ?? 0,
            "efficiency_cores": processorInfo["efficiency_cores"],
            "performance_cores": processorInfo["performance_cores"]
        ]
    }
    
    private func getProcessorInfo() -> [String: Any] {
        // Detect chip type and core configuration
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) {
                String(validatingUTF8: $0)
            }
        }
        
        // Parse device model to determine chip
        let isM1OrNewer = machine?.contains("arm64") ?? false
        
        if isM1OrNewer {
            // Apple Silicon (A14+, M1+)
            return [
                "frequency": 3200, // MHz (max frequency)
                "efficiency_cores": [
                    "count": 4,
                    "usage": 30.0,
                    "watts": 0.5
                ],
                "performance_cores": [
                    "count": 4,
                    "usage": 50.0,
                    "watts": 2.0
                ]
            ]
        } else {
            // Older A-series chips
            return [
                "frequency": 2400,
                "efficiency_cores": nil,
                "performance_cores": [
                    "count": 6,
                    "usage": 40.0,
                    "watts": 1.5
                ]
            ]
        }
    }
    
    private func getMemoryInfo() -> [String: Any] {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_,
                         task_flavor_t(MACH_TASK_BASIC_INFO),
                         $0,
                         &count)
            }
        }
        
        var memoryUsed: Double = 0
        if result == KERN_SUCCESS {
            memoryUsed = Double(info.resident_size) / Double(1024 * 1024) // MB
        }
        
        // Estimate bandwidth based on memory usage changes
        let bandwidth = min(25.0, memoryUsed / 100) // GB/s (simplified)
        
        return [
            "used": memoryUsed,
            "bandwidth": bandwidth
        ]
    }
    
    private func getCPUFrequencyInfo() -> [String: Any] {
        let processorInfo = getProcessorInfo()
        
        var efficiencyFreqs: [Double] = []
        var performanceFreqs: [Double] = []
        
        if let effCores = processorInfo["efficiency_cores"] as? [String: Any],
           let freq = processorInfo["frequency"] as? Double {
            efficiencyFreqs = Array(repeating: freq * 0.6, count: 4) // Efficiency cores run at 60% of max
        }
        
        if let freq = processorInfo["frequency"] as? Double {
            performanceFreqs = Array(repeating: freq, count: 4) // Performance cores at max
        }
        
        return [
            "efficiency": efficiencyFreqs,
            "performance": performanceFreqs
        ]
    }
    
    // Power estimation methods
    private func estimateCPUPower(usage: Double, thermalState: ProcessInfo.ThermalState) -> Double {
        var basePower = 0.5 // Idle power in watts
        let activePower = 4.0 // Max active power
        
        // Adjust for thermal state
        let thermalMultiplier: Double
        switch thermalState {
        case .nominal:
            thermalMultiplier = 1.0
        case .fair:
            thermalMultiplier = 0.9
        case .serious:
            thermalMultiplier = 0.7
        case .critical:
            thermalMultiplier = 0.5
        @unknown default:
            thermalMultiplier = 1.0
        }
        
        return basePower + (usage / 100) * activePower * thermalMultiplier
    }
    
    private func estimateGPUPower(thermalState: ProcessInfo.ThermalState) -> Double {
        // Simplified GPU power estimation
        let baseGPUPower = 0.3
        let activeGPUPower = 3.0
        
        // Assume GPU usage correlates with display updates
        let estimatedUsage = CACurrentMediaTime().truncatingRemainder(dividingBy: 1.0) * 30 // 0-30% usage
        
        return baseGPUPower + (estimatedUsage / 100) * activeGPUPower
    }
    
    private func estimateMemoryPower(usage: Double) -> Double {
        let basePower = 0.3
        let perGBPower = 0.2
        return basePower + (usage / 1024) * perGBPower // Convert MB to GB
    }
    
    private func estimateDisplayPower() -> Double {
        let brightness = UIScreen.main.brightness
        let minPower = 0.5
        let maxPower = 2.0
        return minPower + brightness * (maxPower - minPower)
    }
    
    private func estimateNeuralEnginePower() -> Double {
        // Check if ML computations are likely running
        // This is a simplified estimation
        return 0.1 // Base neural engine power
    }
    
    private func estimateGPUUsage() -> Double {
        // Simplified GPU usage estimation
        return 20.0 // Default 20% usage
    }
    
    private func estimateNeuralEngineUsage() -> Double {
        // Simplified Neural Engine usage estimation
        return 5.0 // Default 5% usage
    }
    
    private func estimateBatteryVoltage() -> Double {
        // Typical iPhone battery voltage
        let batteryLevel = UIDevice.current.batteryLevel
        if batteryLevel < 0 {
            return 3.8 // Default voltage
        }
        // Voltage decreases as battery drains
        return 3.4 + (batteryLevel * 0.6) // 3.4V to 4.0V range
    }
    
    private func estimateBatteryCurrent() -> Double {
        // Estimate current draw in mA
        // This would need actual hardware access for accurate values
        return 500.0 // Default 500mA
    }
    
    private func estimateBatteryCapacity() -> Double {
        // Typical iPhone battery capacity in mAh
        // This varies by model
        return 3000.0 // Default 3000mAh
    }
    
    private func estimateBatteryDrain(totalPower: Double, isCharging: Bool) -> Double {
        if isCharging {
            return 0
        }
        // Convert watts to mA at typical battery voltage
        let voltage = estimateBatteryVoltage()
        return (totalPower / voltage) * 1000 // Convert to mA
    }
    
    private func estimateTemperature(from thermalState: ProcessInfo.ThermalState) -> Double {
        switch thermalState {
        case .nominal:
            return 35.0
        case .fair:
            return 40.0
        case .serious:
            return 45.0
        case .critical:
            return 50.0
        @unknown default:
            return 37.0
        }
    }
    
    // Notification handlers
    @objc private func batteryLevelDidChange() {
        let batteryInfo: [String: Any] = [
            "level": UIDevice.current.batteryLevel,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        sendEvent(withName: "BatteryStateChange", body: batteryInfo)
    }
    
    @objc private func batteryStateDidChange() {
        let device = UIDevice.current
        let batteryInfo: [String: Any] = [
            "level": device.batteryLevel,
            "isCharging": device.batteryState == .charging || device.batteryState == .full,
            "state": batteryStateString(device.batteryState),
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        sendEvent(withName: "BatteryStateChange", body: batteryInfo)
    }
    
    @objc private func thermalStateDidChange() {
        let thermalState = ProcessInfo.processInfo.thermalState
        let stateInfo: [String: Any] = [
            "state": thermalStateString(thermalState),
            "temperature": estimateTemperature(from: thermalState),
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        sendEvent(withName: "ThermalStateChange", body: stateInfo)
    }
    
    private func batteryStateString(_ state: UIDevice.BatteryState) -> String {
        switch state {
        case .unknown:
            return "unknown"
        case .unplugged:
            return "discharging"
        case .charging:
            return "charging"
        case .full:
            return "full"
        @unknown default:
            return "unknown"
        }
    }
    
    private func thermalStateString(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal:
            return "nominal"
        case .fair:
            return "fair"
        case .serious:
            return "serious"
        case .critical:
            return "critical"
        @unknown default:
            return "unknown"
        }
    }
}

// Helper classes
class ThermalStateObserver: NSObject {
    override init() {
        super.init()
    }
}

class BatteryMonitor: NSObject {
    override init() {
        super.init()
    }
}