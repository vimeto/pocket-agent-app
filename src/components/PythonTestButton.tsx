import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { PythonExecutor } from '../services/PythonExecutor';
import { theme } from '../constants/theme';

export const PythonTestButton: React.FC = () => {
  const [testing, setTesting] = useState(false);
  const executor = PythonExecutor.getInstance();

  const runTest = async () => {
    setTesting(true);
    try {
      // Test 1: Simple calculation
      const result1 = await executor.runPythonCode('print(2 + 2)');

      // Test 2: Import and use a library
      const result2 = await executor.runPythonCode(`
import math
print(f"Pi is approximately {math.pi:.4f}")
print(f"Square root of 16 is {math.sqrt(16)}")
`);

      // Test 3: File operations
      await executor.upsertFile('test.py', `
def greet(name):
    return f"Hello, {name}!"

print(greet("World"))
`);

      const result3 = await executor.runPythonFile('test.py');

      // Test 4: List files
      const files = await executor.listFiles();

      Alert.alert('Python Tests Passed!',
        `Test 1: ${result1}\nTest 2: ${result2}\nTest 3: ${result3}\nFiles: ${files.join(', ')}`
      );
    } catch (error) {
      Alert.alert('Python Test Failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={runTest}
      disabled={testing}
    >
      <Text style={styles.text}>
        {testing ? 'Testing Python...' : 'Test Python'}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  text: {
    color: theme.colors.text,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.medium,
    textAlign: 'center',
  },
});
