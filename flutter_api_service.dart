// lib/services/api_service.dart
// Add to Flutter pubspec.yaml: web_socket_channel: ^2.4.0



import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
// rest stays the same...

class ApiService {
  String baseUrl;
  String? _token;

  ApiService({this.baseUrl = 'https://smart-home-backend-nqrg.onrender.com'});

  void setToken(String token) => _token = token;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  // ── Auth ────────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: _headers,
      body: jsonEncode({'email': email, 'password': password}),
    );
    return jsonDecode(res.body);
  }

  // ── Sensors ─────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> getLatestSensor() async {
    final res = await http.get(Uri.parse('$baseUrl/api/sensors/latest'), headers: _headers);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> getSensorHistory({int limit = 60}) async {
    final res = await http.get(
      Uri.parse('$baseUrl/api/sensors/history?limit=$limit'),
      headers: _headers,
    );
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> getSensorStats({int hours = 24}) async {
    final res = await http.get(
      Uri.parse('$baseUrl/api/sensors/stats?hours=$hours'),
      headers: _headers,
    );
    return jsonDecode(res.body);
  }

  // ── Devices ─────────────────────────────────────────────────────────────
  Future<List<dynamic>> getDevices() async {
    final res = await http.get(Uri.parse('$baseUrl/api/devices'), headers: _headers);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> toggleDevice(String id, bool isOn) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/api/devices/$id'),
      headers: _headers,
      body: jsonEncode({'isOn': isOn}),
    );
    return jsonDecode(res.body);
  }

  Future<void> allOff() async =>
      http.post(Uri.parse('$baseUrl/api/devices/all-off'), headers: _headers);

  Future<void> allOn() async =>
      http.post(Uri.parse('$baseUrl/api/devices/all-on'), headers: _headers);

  // ── Alerts ──────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> getAlerts({int page = 1, bool unreadOnly = false}) async {
    final res = await http.get(
      Uri.parse('$baseUrl/api/alerts?page=$page&unread=$unreadOnly'),
      headers: _headers,
    );
    return jsonDecode(res.body);
  }

  Future<int> getUnreadCount() async {
    final res = await http.get(Uri.parse('$baseUrl/api/alerts/unread-count'), headers: _headers);
    return jsonDecode(res.body)['count'] as int;
  }

  Future<void> markAllRead() async =>
      http.post(Uri.parse('$baseUrl/api/alerts/mark-all-read'), headers: _headers);

  Future<Map<String, dynamic>> getThresholds() async {
    final res = await http.get(Uri.parse('$baseUrl/api/alerts/thresholds'), headers: _headers);
    return jsonDecode(res.body);
  }

  Future<void> updateThresholds({
    double? temperatureMax,
    int? gasLevelMax,
    double? ultrasonicMin,
  }) async {
    await http.put(
      Uri.parse('$baseUrl/api/alerts/thresholds'),
      headers: _headers,
      body: jsonEncode({
        if (temperatureMax != null) 'temperatureMax': temperatureMax,
        if (gasLevelMax != null) 'gasLevelMax': gasLevelMax,
        if (ultrasonicMin != null) 'ultrasonicMin': ultrasonicMin,
      }),
    );
  }

  // ── System ───────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> getSystemStatus() async {
    final res = await http.get(Uri.parse('$baseUrl/api/system/status'), headers: _headers);
    return jsonDecode(res.body);
  }

  Future<void> setMode(String mode) async {
    await http.patch(
      Uri.parse('$baseUrl/api/system/mode'),
      headers: _headers,
      body: jsonEncode({'mode': mode}),
    );
  }
}