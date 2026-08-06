import React, { useEffect, useState } from "react";
import {
  BackHandler,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FriendsHomeProvider } from "../stores/FriendsHomeContext";
import { GRAPHITE_COLORS } from "../theme/graphite";
import ContactsScreen from "./ContactsScreen";
import ConversationsScreen from "./ConversationsScreen";
import ProfileScreen from "./ProfileScreen";

export type MainTab = "conversations" | "contacts" | "profile";

const TAB_ITEMS: Array<{ key: MainTab; label: string }> = [
  { key: "conversations", label: "会话" },
  { key: "contacts", label: "通讯录" },
  { key: "profile", label: "我的" },
];

function TabGlyph({ tab, selected }: { tab: MainTab; selected: boolean }) {
  const color = selected ? GRAPHITE_COLORS.primary : GRAPHITE_COLORS.textFaint;
  if (tab === "conversations") {
    return (
      <View style={styles.glyphFrame}>
        <View style={[styles.chatGlyph, { borderColor: color }]} />
        <View style={[styles.chatTail, { borderColor: color }]} />
      </View>
    );
  }
  if (tab === "contacts") {
    return (
      <View style={styles.glyphFrame}>
        <View style={[styles.contactHeadOne, { borderColor: color }]} />
        <View style={[styles.contactHeadTwo, { borderColor: color }]} />
        <View style={[styles.contactBody, { borderColor: color }]} />
      </View>
    );
  }
  return (
    <View style={styles.glyphFrame}>
      <View style={[styles.profileHead, { borderColor: color }]} />
      <View style={[styles.profileBody, { borderColor: color }]} />
    </View>
  );
}

function NavigationItems({
  activeTab,
  onChange,
  wide,
}: {
  activeTab: MainTab;
  onChange: (tab: MainTab) => void;
  wide: boolean;
}) {
  return (
    <View
      style={wide ? styles.railItems : styles.barItems}
      accessibilityRole="tablist"
    >
      {TAB_ITEMS.map((item) => {
        const selected = activeTab === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={[
              styles.tabButton,
              wide && styles.railButton,
              selected && styles.tabButtonSelected,
            ]}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
          >
            <TabGlyph tab={item.key} selected={selected} />
            <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function MainShellScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isFocused = useIsFocused();
  const wide = width >= 720;
  const [activeTab, setActiveTab] = useState<MainTab>(route.params?.tab || "conversations");

  useEffect(() => {
    const requestedTab = route.params?.tab as MainTab | undefined;
    if (requestedTab && TAB_ITEMS.some((item) => item.key === requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [route.params?.tab]);

  useEffect(() => {
    if (!isFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (activeTab === "conversations") return false;
      setActiveTab("conversations");
      return true;
    });
    return () => subscription.remove();
  }, [activeTab, isFocused]);

  const renderScreen = (tab: MainTab, child: React.ReactNode) => {
    const active = activeTab === tab;
    return (
      <View
        style={[styles.screen, !active && styles.hiddenScreen]}
        pointerEvents={active ? "auto" : "none"}
        accessibilityElementsHidden={!active}
        importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      >
        {child}
      </View>
    );
  };

  return (
    <FriendsHomeProvider>
      <View style={[styles.container, wide && styles.wideContainer]}>
        {isFocused ? <ExpoStatusBar style="light" /> : null}

        {wide ? (
          <View style={[styles.navigationRail, { paddingTop: Math.max(insets.top + 16, 32), paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.railBrand}>
              <Text style={styles.railBrandText}>K</Text>
            </View>
            <NavigationItems activeTab={activeTab} onChange={setActiveTab} wide />
          </View>
        ) : null}

        <View style={styles.content}>
          {renderScreen("conversations", <ConversationsScreen navigation={navigation} />)}
          {renderScreen("contacts", <ContactsScreen navigation={navigation} />)}
          {renderScreen("profile", <ProfileScreen navigation={navigation} />)}

          {!wide ? (
            <View style={[
              styles.navigationBar,
              { bottom: Math.max(insets.bottom, 10) },
            ]}>
              <NavigationItems activeTab={activeTab} onChange={setActiveTab} wide={false} />
            </View>
          ) : null}
        </View>
      </View>
    </FriendsHomeProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GRAPHITE_COLORS.canvas },
  wideContainer: { flexDirection: "row" },
  content: { flex: 1, minWidth: 0, position: "relative" },
  screen: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  hiddenScreen: { display: "none" },
  navigationBar: {
    position: "absolute",
    left: 14,
    right: 14,
    minHeight: 72,
    padding: 5,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: GRAPHITE_COLORS.lineStrong,
    backgroundColor: "rgba(0,0,0,0.96)",
    shadowColor: GRAPHITE_COLORS.shadow,
    shadowOpacity: 0.42,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  barItems: { flex: 1, flexDirection: "row", alignItems: "center" },
  tabButton: {
    flex: 1,
    minHeight: 60,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  tabButtonSelected: { backgroundColor: GRAPHITE_COLORS.primarySoft },
  tabLabel: { marginTop: 3, color: GRAPHITE_COLORS.textFaint, fontSize: 10, fontWeight: "700" },
  tabLabelSelected: { color: GRAPHITE_COLORS.primaryStrong },
  glyphFrame: { width: 24, height: 22, alignItems: "center", justifyContent: "center" },
  chatGlyph: { width: 19, height: 14, borderRadius: 6, borderWidth: 1.6 },
  chatTail: { position: "absolute", left: 5, bottom: 2, width: 6, height: 6, borderLeftWidth: 1.6, borderBottomWidth: 1.6, transform: [{ rotate: "-32deg" }] },
  contactHeadOne: { position: "absolute", left: 4, top: 2, width: 7, height: 7, borderRadius: 4, borderWidth: 1.5 },
  contactHeadTwo: { position: "absolute", right: 4, top: 4, width: 6, height: 6, borderRadius: 3, borderWidth: 1.5 },
  contactBody: { position: "absolute", left: 3, bottom: 2, width: 18, height: 9, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderWidth: 1.5, borderBottomWidth: 0 },
  profileHead: { position: "absolute", top: 1, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  profileBody: { position: "absolute", bottom: 1, width: 18, height: 10, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderWidth: 1.5, borderBottomWidth: 0 },
  navigationRail: {
    width: 92,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: GRAPHITE_COLORS.line,
    alignItems: "center",
    backgroundColor: GRAPHITE_COLORS.canvas,
  },
  railBrand: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: GRAPHITE_COLORS.primaryLine, backgroundColor: GRAPHITE_COLORS.primarySoft },
  railBrandText: { color: GRAPHITE_COLORS.primaryStrong, fontSize: 20, fontWeight: "800" },
  railItems: { flex: 1, width: "100%", marginTop: 30, alignItems: "center", gap: 8 },
  railButton: { flex: 0, width: 76, minHeight: 68 },
});
