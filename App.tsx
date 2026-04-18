import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import useMapperStore from './src/store/useMapperStore';
import { setAuthToken } from './src/services/api';
import MapScreen from './src/screens/MapScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();

function MainApp() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#FFFFFF', borderTopColor: '#E2E8F0' },
        tabBarActiveTintColor: '#22C55E',
        tabBarLabelStyle: { fontWeight: '700', fontSize: 11 },
      }}
    >
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 20 }}>📡</Text> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 20 }}>👤</Text> }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const { token, setToken, setEvmAddress } = useMapperStore();

  useEffect(() => {
    if (!token) {
      const devToken = 'dev-token-' + Date.now();
      setToken(devToken);
      setAuthToken(devToken);
      setEvmAddress('0x0000000000000000000000000000000000000001');
    }
  }, [token]);

  return (
    <NavigationContainer>
      <MainApp />
    </NavigationContainer>
  );
}
