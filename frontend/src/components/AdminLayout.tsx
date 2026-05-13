import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Typography, theme } from 'antd';
import { PlusSquareOutlined, FolderOpenOutlined, SettingOutlined } from '@ant-design/icons';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

const navItems = [
  { key: '/projects/new', label: '新建项目', icon: <PlusSquareOutlined />, caption: '上传素材并开始生成' },
  { key: '/projects', label: '项目管理', icon: <FolderOpenOutlined />, caption: '历史项目与继续处理' },
  { key: '/settings/model', label: '模型配置', icon: <SettingOutlined />, caption: '网关、模型与生成参数' },
];

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('ssoToken')) {
      url.searchParams.delete('ssoToken');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  function getActiveKey() {
    if (location.pathname.startsWith('/projects/new')) return '/projects/new';
    if (location.pathname.startsWith('/settings/model')) return '/settings/model';
    if (
      location.pathname.startsWith('/projects') ||
      location.pathname.startsWith('/workspace/') ||
      location.pathname.startsWith('/review/')
    ) {
      return '/projects';
    }
    return location.pathname;
  }

  const menuItems = navItems.map((item) => ({
    key: item.key,
    icon: React.cloneElement(item.icon as React.ReactElement<{ style?: React.CSSProperties }>, { style: { fontSize: '18px', marginTop: '6px' } }),
    label: (
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4', padding: '8px 0' }}>
        <strong style={{ fontSize: '15px' }}>{item.label}</strong>
        <span style={{ fontSize: '12px', color: '#8c8c8c' }}>{item.caption}</span>
      </div>
    ),
    style: { height: 'auto', padding: '12px 16px', lineHeight: 'normal' }
  }));

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden', background: '#f5f7fa' }}>
      <Sider width={280} theme="light" style={{ borderRight: '1px solid #f0f0f0', height: '100vh', overflow: 'auto' }}>
        <div style={{ padding: '24px 20px 16px' }}>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>PROMPT CONSOLE</Text>
          <Title level={3} style={{ margin: '4px 0 8px' }}>MD2PPT管理台</Title>
          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6, display: 'block' }}>
            统一管理模型配置、历史项目、生成工作台与审核导出。
          </Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[getActiveKey()]}
          onClick={({ key }) => navigate(key)}
          items={menuItems}
          style={{ borderRight: 0, padding: '0 12px' }}
        />
      </Sider>
      <Layout style={{ background: '#f5f7fa', height: '100vh' }}>
        <Content style={{ padding: '24px 32px 32px', margin: 0, backgroundColor: '#f5f7fa', overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
