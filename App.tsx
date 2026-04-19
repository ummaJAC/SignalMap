import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import useMapperStore from './src/store/useMapperStore';
import { setAuthToken } from './src/services/api';
import MapScreen from './src/screens/MapScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import LoginScreen from './src/screens/LoginScreen';

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
        options={{ tabBarIcon: () => <Text style={{ fontSize: 20 }}>Map</Text> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 20 }}>User</Text> }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const { token, reset } = useMapperStore();

  useEffect(() => {
    if (token?.startsWith('dev-token-')) {
      reset();
      setAuthToken(null);
      return;
    }

    setAuthToken(token || null);
  }, [reset, token]);

  return (
    <NavigationContainer>
      {token && !token.startsWith('dev-token-') ? <MainApp /> : <LoginScreen />}
    </NavigationContainer>
  );
}
