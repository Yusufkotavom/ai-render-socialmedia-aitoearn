'use client'

import React, { useEffect, useState } from 'react'
import { getSystemLogsApi, GetLogsParams } from '@/api/systemLogs'

export default function SystemLogsPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [params, setParams] = useState<GetLogsParams>({
    page: 1,
    limit: 50,
    level: 'all',
    search: '',
  })

  const fetchLogs = async (currentParams = params) => {
    setLoading(true)
    try {
      const res = await getSystemLogsApi(currentParams)
      if (res) {
        setLogs((res as any).items || [])
        setTotal((res as any).total || 0)
      }
    } catch (error) {
      console.error('Failed to fetch logs', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs(params)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.page, params.level])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setParams(p => ({ ...p, page: 1 }))
    fetchLogs({ ...params, page: 1 })
  }

  return (
    <div className="p-6 h-[calc(100vh-64px)] flex flex-col bg-gray-50">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-gray-800">System Logs</h1>
        <div className="flex gap-4">
          <select 
            value={params.level}
            onChange={(e) => setParams(p => ({ ...p, level: e.target.value, page: 1 }))}
            className="border p-2 rounded bg-white text-sm"
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input 
              type="text" 
              placeholder="Search message..." 
              value={params.search}
              onChange={(e) => setParams(p => ({ ...p, search: e.target.value }))}
              className="border p-2 rounded text-sm min-w-[250px]"
            />
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm transition-colors">
              Search
            </button>
          </form>
          <button onClick={() => fetchLogs()} className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded text-sm transition-colors">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white border rounded shadow-sm relative">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-100 sticky top-0 shadow-sm z-10">
            <tr>
              <th className="p-3 border-b font-semibold text-gray-600 text-sm">Time</th>
              <th className="p-3 border-b font-semibold text-gray-600 text-sm">Level</th>
              <th className="p-3 border-b font-semibold text-gray-600 text-sm">Message</th>
              <th className="p-3 border-b font-semibold text-gray-600 text-sm">Context</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="p-8 text-center text-gray-500">Loading logs...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={4} className="p-8 text-center text-gray-500">No logs found</td></tr>
            ) : (
              logs.map((log, i) => {
                const isError = log.level === 'error' || log.level === 'fatal' || log.fatal
                return (
                  <tr key={i} className={`hover:bg-gray-50 border-b ${isError ? 'bg-red-50/30' : ''}`}>
                    <td className="p-3 whitespace-nowrap text-sm text-gray-500 align-top">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}
                    </td>
                    <td className="p-3 align-top">
                      <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                        isError ? 'bg-red-100 text-red-800' :
                        log.level === 'warn' ? 'bg-yellow-100 text-yellow-800' :
                        log.level === 'info' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {log.level || 'unknown'}
                      </span>
                    </td>
                    <td className={`p-3 text-sm align-top break-words ${isError ? 'text-red-700 font-medium' : 'text-gray-700'}`}>
                      {log.message}
                    </td>
                    <td className="p-3 text-xs text-gray-500 max-w-xs align-top">
                      <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words bg-gray-50 p-2 rounded border font-mono">
                        {JSON.stringify(log.meta || log.context || log, (key, value) => {
                          if (key === 'message' || key === 'level' || key === 'timestamp' || key === '_id') return undefined
                          return value
                        }, 2)}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      
      <div className="mt-4 flex justify-between items-center bg-white p-3 border rounded shadow-sm">
        <div className="text-sm text-gray-600 font-medium">
          Total Logs: <span className="text-gray-900">{total}</span>
        </div>
        <div className="flex gap-2 items-center">
          <button 
            disabled={params.page === 1}
            onClick={() => setParams(p => ({ ...p, page: (p.page || 1) - 1 }))}
            className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-gray-50 transition-colors text-sm"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-sm font-medium text-gray-700">Page {params.page}</span>
          <button 
            disabled={logs.length < (params.limit || 50)}
            onClick={() => setParams(p => ({ ...p, page: (p.page || 1) + 1 }))}
            className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-gray-50 transition-colors text-sm"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
