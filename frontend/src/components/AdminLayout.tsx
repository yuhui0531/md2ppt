import { NavLink, Outlet, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/projects/new', label: '新建项目', caption: '上传素材并开始生成' },
  { to: '/projects', label: '项目管理', caption: '历史项目与继续处理', end: true },
  { to: '/settings/model', label: '模型配置', caption: '网关、模型与生成参数' },
];

export function AdminLayout() {
  const location = useLocation();

  function isNavItemActive(path: string): boolean {
    if (path === '/projects') {
      return location.pathname === '/projects'
        || location.pathname.startsWith('/workspace/')
        || location.pathname.startsWith('/review/');
    }

    if (path === '/projects/new') {
      return location.pathname === '/projects/new';
    }

    if (path === '/settings/model') {
      return location.pathname === '/settings/model';
    }

    return location.pathname === path;
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-block">
          <p className="brand-kicker">Prompt Console</p>
          <h1>Markdown PPT 管理台</h1>
          <p className="brand-copy">统一管理模型配置、历史项目、生成工作台与审核导出。</p>
        </div>

        <nav className="admin-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={() => `admin-nav-item${isNavItemActive(item.to) ? ' active' : ''}`}
            >
              <strong>{item.label}</strong>
              <span>{item.caption}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="admin-main">
        <Outlet />
      </div>
    </div>
  );
}
