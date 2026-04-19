package com.knayx.signalmap

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.CellInfo
import android.telephony.CellInfoCdma
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoWcdma
import android.telephony.CellInfoNr
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments

class CellularInfoModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "CellularInfo"
    }

    @ReactMethod
    fun getCellularInfo(promise: Promise) {
        val telephonyManager = reactApplicationContext.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        
        val map: WritableMap = Arguments.createMap()
        map.putString("carrier", telephonyManager.networkOperatorName ?: "Unknown")

        if (ContextCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            promise.resolve(map)
            return
        }

        try {
            val cellInfoList = telephonyManager.allCellInfo
            if (cellInfoList != null && cellInfoList.isNotEmpty()) {
                val cellInfo = cellInfoList.firstOrNull { it.isRegistered } ?: cellInfoList[0]
                var signalDbm: Int? = null
                var technology = "Unknown"

                if (cellInfo is CellInfoLte) {
                    signalDbm = cellInfo.cellSignalStrength.dbm
                    technology = "4G/LTE"
                } else if (cellInfo is CellInfoWcdma) {
                    signalDbm = cellInfo.cellSignalStrength.dbm
                    technology = "3G"
                } else if (cellInfo is CellInfoGsm) {
                    signalDbm = cellInfo.cellSignalStrength.dbm
                    technology = "2G"
                } else if (cellInfo is CellInfoCdma) {
                    signalDbm = cellInfo.cellSignalStrength.dbm
                    technology = "CDMA"
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && cellInfo is CellInfoNr) {
                    signalDbm = cellInfo.cellSignalStrength.dbm
                    technology = "5G"
                }

                if (signalDbm != null) {
                    map.putInt("signalDbm", signalDbm)
                }
                map.putString("technology", technology)
            }
        } catch (e: Exception) {
        }

        promise.resolve(map)
    }
}
