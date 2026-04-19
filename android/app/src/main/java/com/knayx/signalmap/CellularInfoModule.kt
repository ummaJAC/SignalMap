package com.knayx.signalmap

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.telephony.CellIdentityCdma
import android.telephony.CellIdentityGsm
import android.telephony.CellIdentityLte
import android.telephony.CellIdentityNr
import android.telephony.CellIdentityWcdma
import android.telephony.CellInfo
import android.telephony.CellInfoCdma
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

class CellularInfoModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "CellularInfo"
    }

    @ReactMethod
    fun getCellularInfo(promise: Promise) {
        val map: WritableMap = Arguments.createMap()

        try {
            addTelephonyInfo(map)
        } catch (e: Exception) {
            map.putString("cellularError", e.message ?: "cellular_error")
        }

        try {
            addWifiInfo(map)
        } catch (e: Exception) {
            map.putString("wifiError", e.message ?: "wifi_error")
        }

        promise.resolve(map)
    }

    private fun addTelephonyInfo(map: WritableMap) {
        val telephonyManager = reactApplicationContext.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager

        val networkOperatorName = telephonyManager.networkOperatorName
        val simOperatorName = telephonyManager.simOperatorName
        val networkOperator = telephonyManager.networkOperator
        val simOperator = telephonyManager.simOperator

        map.putString("networkOperatorName", safeString(networkOperatorName))
        map.putString("simOperatorName", safeString(simOperatorName))
        map.putString("carrier", safeString(networkOperatorName).ifBlank { safeString(simOperatorName) })
        map.putString("networkOperator", safeString(networkOperator))
        map.putString("simOperator", safeString(simOperator))

        parseMccMnc(networkOperator).let {
            if (it.first != null) map.putString("mcc", it.first)
            if (it.second != null) map.putString("mnc", it.second)
        }

        val networkType = telephonyManager.dataNetworkType.takeIf { it != TelephonyManager.NETWORK_TYPE_UNKNOWN }
            ?: telephonyManager.networkType
        val networkTypeName = networkTypeName(networkType)
        map.putString("networkType", networkTypeName)
        map.putString("cellularGeneration", generationFromNetworkType(networkType))
        map.putString("technology", generationFromNetworkType(networkType))

        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            map.putString("cellularPermission", "missing_location")
            return
        }

        val cellInfoList = telephonyManager.allCellInfo ?: emptyList()
        val cells = Arguments.createArray()
        val selected = cellInfoList.firstOrNull { it.isRegistered } ?: cellInfoList.firstOrNull()

        for (cellInfo in cellInfoList.take(8)) {
            cells.pushMap(cellInfoToMap(cellInfo))
        }
        map.putArray("cells", cells)

        if (selected != null) {
            val selectedMap = cellInfoToMap(selected)
            map.merge(selectedMap)
        }
    }

    private fun addWifiInfo(map: WritableMap) {
        if (!hasPermission(Manifest.permission.ACCESS_WIFI_STATE)) {
            map.putString("wifiPermission", "missing_access_wifi_state")
            return
        }

        val wifiManager = reactApplicationContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            ?: return
        val info: WifiInfo = wifiManager.connectionInfo ?: return

        map.putString("wifiSsid", sanitizeWifiString(info.ssid))
        map.putString("wifiBssid", sanitizeWifiString(info.bssid))
        map.putInt("wifiRssi", info.rssi)
        map.putInt("wifiLinkSpeedMbps", info.linkSpeed)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            map.putInt("wifiFrequencyMhz", info.frequency)
        }
        map.putString("wifiIpAddress", intToIp(info.ipAddress))
    }

    private fun cellInfoToMap(cellInfo: CellInfo): WritableMap {
        val map = Arguments.createMap()
        map.putBoolean("isRegistered", cellInfo.isRegistered)

        when (cellInfo) {
            is CellInfoLte -> {
                val identity = cellInfo.cellIdentity as CellIdentityLte
                val signal = cellInfo.cellSignalStrength
                map.putString("radioType", "LTE")
                putIntIfValid(map, "cellId", identity.ci)
                putIntIfValid(map, "tac", identity.tac)
                putIntIfValid(map, "pci", identity.pci)
                putIntIfValid(map, "earfcn", identity.earfcn)
                putStringIfNotBlank(map, "mcc", identity.mccString)
                putStringIfNotBlank(map, "mnc", identity.mncString)
                putSignal(map, signal.dbm, signal.asuLevel)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    putIntIfValid(map, "rsrp", signal.rsrp)
                    putIntIfValid(map, "rsrq", signal.rsrq)
                    putIntIfValid(map, "rssnr", signal.rssnr)
                    putIntIfValid(map, "sinr", signal.rssnr)
                }
                map.putString("technology", "4G/LTE")
                map.putString("cellularGeneration", "4G")
            }
            is CellInfoWcdma -> {
                val identity = cellInfo.cellIdentity as CellIdentityWcdma
                val signal = cellInfo.cellSignalStrength
                map.putString("radioType", "WCDMA")
                putIntIfValid(map, "cellId", identity.cid)
                putIntIfValid(map, "lac", identity.lac)
                putIntIfValid(map, "psc", identity.psc)
                putIntIfValid(map, "uarfcn", identity.uarfcn)
                putStringIfNotBlank(map, "mcc", identity.mccString)
                putStringIfNotBlank(map, "mnc", identity.mncString)
                putSignal(map, signal.dbm, signal.asuLevel)
                map.putString("technology", "3G")
                map.putString("cellularGeneration", "3G")
            }
            is CellInfoGsm -> {
                val identity = cellInfo.cellIdentity as CellIdentityGsm
                val signal = cellInfo.cellSignalStrength
                map.putString("radioType", "GSM")
                putIntIfValid(map, "cellId", identity.cid)
                putIntIfValid(map, "lac", identity.lac)
                putIntIfValid(map, "arfcn", identity.arfcn)
                putIntIfValid(map, "bsic", identity.bsic)
                putStringIfNotBlank(map, "mcc", identity.mccString)
                putStringIfNotBlank(map, "mnc", identity.mncString)
                putSignal(map, signal.dbm, signal.asuLevel)
                map.putString("technology", "2G")
                map.putString("cellularGeneration", "2G")
            }
            is CellInfoCdma -> {
                val identity = cellInfo.cellIdentity as CellIdentityCdma
                val signal = cellInfo.cellSignalStrength
                map.putString("radioType", "CDMA")
                putIntIfValid(map, "cellId", identity.basestationId)
                putIntIfValid(map, "networkId", identity.networkId)
                putIntIfValid(map, "systemId", identity.systemId)
                putSignal(map, signal.dbm, signal.asuLevel)
                map.putString("technology", "CDMA")
            }
            is CellInfoNr -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val identity = cellInfo.cellIdentity as CellIdentityNr
                    val signal = cellInfo.cellSignalStrength
                    map.putString("radioType", "NR")
                    map.putDouble("cellId", identity.nci.toDouble())
                    putIntIfValid(map, "tac", identity.tac)
                    putIntIfValid(map, "pci", identity.pci)
                    putIntIfValid(map, "nrarfcn", identity.nrarfcn)
                    putStringIfNotBlank(map, "mcc", identity.mccString)
                    putStringIfNotBlank(map, "mnc", identity.mncString)
                    putSignal(map, signal.dbm, signal.asuLevel)
                    map.putString("technology", "5G")
                    map.putString("cellularGeneration", "5G")
                }
            }
        }

        return map
    }

    private fun putSignal(map: WritableMap, dbm: Int, asuLevel: Int) {
        putIntIfValid(map, "dbm", dbm)
        putIntIfValid(map, "signalDbm", dbm)
        putIntIfValid(map, "asuLevel", asuLevel)
    }

    private fun putIntIfValid(map: WritableMap, key: String, value: Int) {
        if (value != Int.MAX_VALUE && value != Int.MIN_VALUE && value != 2147483647 && value != -1) {
            map.putInt(key, value)
        }
    }

    private fun putStringIfNotBlank(map: WritableMap, key: String, value: String?) {
        val cleaned = safeString(value)
        if (cleaned.isNotBlank()) map.putString(key, cleaned)
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(reactApplicationContext, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun safeString(value: String?): String {
        return value?.trim().orEmpty()
    }

    private fun sanitizeWifiString(value: String?): String {
        val cleaned = safeString(value).trim('"')
        if (cleaned.isBlank() || cleaned.equals("<unknown ssid>", ignoreCase = true) || cleaned == "02:00:00:00:00:00") {
            return ""
        }
        return cleaned
    }

    private fun parseMccMnc(operator: String?): Pair<String?, String?> {
        val clean = safeString(operator)
        if (clean.length < 5) return Pair(null, null)
        return Pair(clean.substring(0, 3), clean.substring(3))
    }

    private fun intToIp(value: Int): String {
        if (value == 0) return ""
        return "${value and 0xff}.${value shr 8 and 0xff}.${value shr 16 and 0xff}.${value shr 24 and 0xff}"
    }

    private fun networkTypeName(type: Int): String {
        return when (type) {
            TelephonyManager.NETWORK_TYPE_GPRS -> "GPRS"
            TelephonyManager.NETWORK_TYPE_EDGE -> "EDGE"
            TelephonyManager.NETWORK_TYPE_UMTS -> "UMTS"
            TelephonyManager.NETWORK_TYPE_CDMA -> "CDMA"
            TelephonyManager.NETWORK_TYPE_EVDO_0 -> "EVDO_0"
            TelephonyManager.NETWORK_TYPE_EVDO_A -> "EVDO_A"
            TelephonyManager.NETWORK_TYPE_1xRTT -> "1xRTT"
            TelephonyManager.NETWORK_TYPE_HSDPA -> "HSDPA"
            TelephonyManager.NETWORK_TYPE_HSUPA -> "HSUPA"
            TelephonyManager.NETWORK_TYPE_HSPA -> "HSPA"
            TelephonyManager.NETWORK_TYPE_IDEN -> "IDEN"
            TelephonyManager.NETWORK_TYPE_EVDO_B -> "EVDO_B"
            TelephonyManager.NETWORK_TYPE_LTE -> "LTE"
            TelephonyManager.NETWORK_TYPE_EHRPD -> "EHRPD"
            TelephonyManager.NETWORK_TYPE_HSPAP -> "HSPAP"
            TelephonyManager.NETWORK_TYPE_GSM -> "GSM"
            TelephonyManager.NETWORK_TYPE_TD_SCDMA -> "TD_SCDMA"
            TelephonyManager.NETWORK_TYPE_IWLAN -> "IWLAN"
            TelephonyManager.NETWORK_TYPE_NR -> "NR"
            else -> "UNKNOWN"
        }
    }

    private fun generationFromNetworkType(type: Int): String {
        return when (type) {
            TelephonyManager.NETWORK_TYPE_GPRS,
            TelephonyManager.NETWORK_TYPE_EDGE,
            TelephonyManager.NETWORK_TYPE_CDMA,
            TelephonyManager.NETWORK_TYPE_1xRTT,
            TelephonyManager.NETWORK_TYPE_IDEN,
            TelephonyManager.NETWORK_TYPE_GSM -> "2G"
            TelephonyManager.NETWORK_TYPE_UMTS,
            TelephonyManager.NETWORK_TYPE_EVDO_0,
            TelephonyManager.NETWORK_TYPE_EVDO_A,
            TelephonyManager.NETWORK_TYPE_HSDPA,
            TelephonyManager.NETWORK_TYPE_HSUPA,
            TelephonyManager.NETWORK_TYPE_HSPA,
            TelephonyManager.NETWORK_TYPE_EVDO_B,
            TelephonyManager.NETWORK_TYPE_EHRPD,
            TelephonyManager.NETWORK_TYPE_HSPAP,
            TelephonyManager.NETWORK_TYPE_TD_SCDMA -> "3G"
            TelephonyManager.NETWORK_TYPE_LTE,
            TelephonyManager.NETWORK_TYPE_IWLAN -> "4G"
            TelephonyManager.NETWORK_TYPE_NR -> "5G"
            else -> "Unknown"
        }
    }
}
